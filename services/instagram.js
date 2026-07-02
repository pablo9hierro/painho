// Instagram Business Content Publishing API
// Docs: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/content-publishing

const IG_API = 'https://graph.instagram.com/v21.0';

async function igRequest(method, path, body = null) {
  const url = `${IG_API}${path}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (data.error) throw new Error(`Instagram API: ${data.error.message} (code ${data.error.code})`);
  return data;
}

/**
 * Posta uma imagem no Instagram.
 * Requer: INSTAGRAM_USER_ID e INSTAGRAM_ACCESS_TOKEN no .env
 *
 * @param {string} imageUrl  URL pública da imagem (ex: Cloudinary)
 * @param {string} caption   Legenda do post
 */
async function postToInstagram(imageUrl, caption) {
  const userId = process.env.INSTAGRAM_USER_ID;
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;

  if (!userId || !token) {
    throw new Error(
      'Configure INSTAGRAM_USER_ID e INSTAGRAM_ACCESS_TOKEN no arquivo .env'
    );
  }

  // Passo 1: Criar container de mídia
  const container = await igRequest('POST', `/${userId}/media?access_token=${token}`, {
    image_url: imageUrl,
    caption,
  });
  console.log('[instagram] Container criado:', container.id);

  // Passo 2: Publicar o container
  const publish = await igRequest('POST', `/${userId}/media_publish?access_token=${token}`, {
    creation_id: container.id,
  });
  console.log('[instagram] Publicado! Post ID:', publish.id);

  return publish;
}

/**
 * Renova o token por mais 60 dias.
 * Chame isso antes do token expirar (é seguro renovar a qualquer momento).
 */
async function refreshToken() {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) throw new Error('INSTAGRAM_ACCESS_TOKEN não configurado');

  const url = `${IG_API}/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);

  console.log('[instagram] Token renovado! Expira em:', Math.floor(data.expires_in / 86400), 'dias');
  return data;
}

/**
 * Retorna o Instagram User ID da conta autenticada.
 * Útil para pegar o ID uma vez e colocar no .env
 */
async function getMyUserId() {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const url = `${IG_API}/me?fields=id,username&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

module.exports = { postToInstagram, refreshToken, getMyUserId };
