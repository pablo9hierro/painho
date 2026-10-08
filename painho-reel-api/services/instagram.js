// Instagram Business Content Publishing via Facebook Graph API
// Usa System User Token com acesso via Page → Instagram Business Account

const IG_API = 'https://graph.facebook.com/v21.0';

async function igPost(endpoint, body, token) {
  const url = `${IG_API}${endpoint}`;
  const params = new URLSearchParams({ access_token: token, ...body });
  const res = await fetch(url, { method: 'POST', body: params });
  const data = await res.json();
  if (data.error) throw new Error(`Instagram API [${data.error.code}]: ${data.error.message}`);
  return data;
}

async function igGet(endpoint, token) {
  const sep = endpoint.includes('?') ? '&' : '?';
  const url = `${IG_API}${endpoint}${sep}access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`Instagram API [${data.error.code}]: ${data.error.message}`);
  return data;
}

/**
 * Aguarda o container de mídia ficar FINISHED antes de publicar.
 * Erro [9007] "Media ID is not available" acontece quando publicamos
 * antes da imagem terminar de processar no servidor do Instagram.
 */
async function waitForContainer(containerId, token, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const data = await igGet(`/${containerId}?fields=status_code,status`, token);
    const code = data.status_code;
    if (code === 'FINISHED')  return;
    if (code === 'ERROR')     throw new Error(`Instagram processamento falhou: ${data.status || 'ERROR'}`);
    if (code === 'EXPIRED')   throw new Error('Container expirou sem ser publicado');
    // IN_PROGRESS ou undefined — aguarda 4s e tenta de novo
    console.log(`[instagram] Container ${containerId}: ${code || '?'} — aguardando...`);
    await new Promise(r => setTimeout(r, 4000));
  }
  throw new Error('Timeout aguardando container do Instagram ficar pronto');
}

/**
 * Posta uma imagem no Instagram @primeirasnoticias_
 * @param {string} imageUrl  URL pública da imagem (Cloudinary)
 * @param {string} caption   Legenda do post
 */
async function postToInstagram(imageUrl, caption, onRetry) {
  const userId = process.env.INSTAGRAM_USER_ID;
  const token  = process.env.INSTAGRAM_ACCESS_TOKEN;

  if (!userId || !token) throw new Error('INSTAGRAM_USER_ID e INSTAGRAM_ACCESS_TOKEN são obrigatórios no .env');

  // Passo 1: criar container de mídia.
  // A criação do container é instável do lado do Instagram: a mesma imagem, sem
  // nenhuma mudança, pode falhar com erro 9004/1 numa tentativa e funcionar na
  // próxima (taxa observada: ~1 em cada 5 tentativas falha). Tenta até 5 vezes
  // antes de desistir de verdade.
  const MAX_TENTATIVAS = 5;
  let container;
  for (let tentativa = 1; ; tentativa++) {
    try {
      container = await igPost(`/${userId}/media`, { image_url: imageUrl, caption }, token);
      break;
    } catch (e) {
      if (tentativa >= MAX_TENTATIVAS) throw e;
      const msg = `Falha ao criar o post (tentativa ${tentativa}/${MAX_TENTATIVAS}): ${e.message} — tentando de novo...`;
      console.log(`[instagram] ${msg}`);
      onRetry?.(msg);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  console.log('[instagram] Container criado:', container.id);

  // Passo 2: aguarda processamento (evita erro 9007)
  await waitForContainer(container.id, token);

  // Passo 3: publicar
  const publish = await igPost(`/${userId}/media_publish`, { creation_id: container.id }, token);
  console.log('[instagram] Publicado! Post ID:', publish.id);

  return publish;
}

/**
 * Posta um Reel (vídeo) no Instagram @primeirasnoticias_
 * @param {string} videoUrl  URL pública do vídeo (Cloudinary)
 * @param {string} caption   Legenda do post
 * @param {string[]} collaborators  @handles convidados como collab (opcional, máx 3 na API)
 */
async function postReelToInstagram(videoUrl, caption, collaborators, onRetry) {
  const userId = process.env.INSTAGRAM_USER_ID;
  const token  = process.env.INSTAGRAM_ACCESS_TOKEN;

  if (!userId || !token) throw new Error('INSTAGRAM_USER_ID e INSTAGRAM_ACCESS_TOKEN são obrigatórios no .env');

  const body = { media_type: 'REELS', video_url: videoUrl, caption };
  if (collaborators && collaborators.length) {
    body.collaborators = JSON.stringify(collaborators.map((h) => h.replace(/^@/, '')));
  }

  // criação do container pode falhar de forma intermitente, igual a imagem — tenta algumas vezes antes de desistir
  const MAX_TENTATIVAS = 5;
  let container;
  for (let tentativa = 1; ; tentativa++) {
    try {
      container = await igPost(`/${userId}/media`, body, token);
      break;
    } catch (e) {
      if (tentativa >= MAX_TENTATIVAS) throw e;
      const msg = `Falha ao criar o Reel (tentativa ${tentativa}/${MAX_TENTATIVAS}): ${e.message} — tentando de novo...`;
      console.log(`[instagram] ${msg}`);
      onRetry?.(msg);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  console.log('[instagram] Container do Reel criado:', container.id);

  // vídeo demora bem mais que imagem pra processar — teto maior
  await waitForContainer(container.id, token, 180000);

  const publish = await igPost(`/${userId}/media_publish`, { creation_id: container.id }, token);
  console.log('[instagram] Reel publicado! Post ID:', publish.id);

  return publish;
}

/**
 * Retorna info da conta Instagram autenticada
 */
async function getMyAccount() {
  const userId = process.env.INSTAGRAM_USER_ID;
  const token  = process.env.INSTAGRAM_ACCESS_TOKEN;
  return igGet(`/${userId}?fields=id,username,name,followers_count`, token);
}

/**
 * Renova o token de longa duração (60 dias) trocando o token atual
 * por um novo via fb_exchange_token. Precisa estar válido ainda.
 */
async function refreshToken() {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appId || !appSecret) throw new Error('INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET são obrigatórios no .env');

  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: token,
  });
  const res = await fetch(`${IG_API}/oauth/access_token?${params}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  console.log('[instagram] Token renovado! Expira em ~60 dias');
  return data;
}

module.exports = { postToInstagram, postReelToInstagram, getMyAccount, refreshToken };
