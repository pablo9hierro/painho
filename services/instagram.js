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
async function postToInstagram(imageUrl, caption) {
  const userId = process.env.INSTAGRAM_USER_ID;
  const token  = process.env.INSTAGRAM_ACCESS_TOKEN;

  if (!userId || !token) throw new Error('INSTAGRAM_USER_ID e INSTAGRAM_ACCESS_TOKEN são obrigatórios no .env');

  // Passo 1: criar container de mídia
  const container = await igPost(`/${userId}/media`, { image_url: imageUrl, caption }, token);
  console.log('[instagram] Container criado:', container.id);

  // Passo 2: aguarda processamento (evita erro 9007)
  await waitForContainer(container.id, token);

  // Passo 3: publicar
  const publish = await igPost(`/${userId}/media_publish`, { creation_id: container.id }, token);
  console.log('[instagram] Publicado! Post ID:', publish.id);

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
 * Renova o token por mais 60 dias (só funciona com user tokens, não system user)
 */
async function refreshToken() {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const url = `${IG_API}/oauth/access_token`;
  const params = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token });
  const res = await fetch(`${url}?${params}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  console.log('[instagram] Token renovado! Expira em:', Math.floor(data.expires_in / 86400), 'dias');
  return data;
}

module.exports = { postToInstagram, getMyAccount, refreshToken };
