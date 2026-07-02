const { newPage, saveSession } = require('./browser');

const LOGIN_URL = process.env.WEBSG_URL || 'https://primeirasnoticias.com.br/websg/';
const NEWS_LIST_URL = 'https://primeirasnoticias.com.br/websg/?p=noticias&frm=Listar';

// Delay humano entre ações (ms)
function humanDelay(min = 300, max = 900) {
  return new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));
}

async function isLoggedIn(page) {
  try {
    await page.goto(NEWS_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const url = page.url();
    return url.includes('frm=Listar');
  } catch (_) {
    return false;
  }
}

async function login() {
  const page = await newPage();

  // Testa se já tem sessão ativa
  if (await isLoggedIn(page)) {
    console.log('[auth] Sessão ativa encontrada — pulando login');
    return page;
  }

  console.log('[auth] Abrindo página de login...');
  await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
  await humanDelay(500, 1200);

  // Preenche usuário
  const userInput = page.locator('input[name="usuario"], input[type="text"]').first();
  await userInput.click();
  await humanDelay(200, 500);
  await userInput.fill('');
  await page.keyboard.type(process.env.WEBSG_USER, { delay: 60 });
  await humanDelay(300, 700);

  // Preenche senha
  const passInput = page.locator('input[name="senha"], input[type="password"]').first();
  await passInput.click();
  await humanDelay(200, 400);
  await passInput.fill('');
  await page.keyboard.type(process.env.WEBSG_PASS, { delay: 70 });
  await humanDelay(400, 900);

  // Clica em Entrar
  await page.locator('button[type="submit"], input[type="submit"], .btn-primary').first().click();
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 });

  const currentUrl = page.url();
  console.log('[auth] Após login, URL:', currentUrl);

  if (currentUrl.includes('websg') && !currentUrl.includes('login')) {
    console.log('[auth] Login bem-sucedido!');
    await saveSession();
  } else {
    throw new Error('[auth] Falha no login — verifique credenciais');
  }

  // Navega para lista de notícias clicando no seletor do painel
  await humanDelay(600, 1200);
  console.log('[auth] Clicando em Gerenciar Notícias...');

  try {
    const newsLink = page.locator('#widget_boxs > div > div.panel-heading > div > a').first();
    await newsLink.waitFor({ state: 'visible', timeout: 10000 });
    await newsLink.click();
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 });
    console.log('[auth] Navegou para:', page.url());
  } catch (e) {
    // fallback: navegar direto pela URL
    console.log('[auth] Fallback: navegando direto para lista de notícias');
    await page.goto(NEWS_LIST_URL, { waitUntil: 'networkidle' });
  }

  return page;
}

module.exports = { login, humanDelay };
