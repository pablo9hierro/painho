const { newPage, saveSession } = require('./browser');

const LOGIN_URL = process.env.WEBSG_URL || 'https://primeirasnoticias.com.br/websg/';
const NEWS_LIST_URL = 'https://primeirasnoticias.com.br/websg/?p=noticias&frm=Listar';

// Delay humano entre ações (ms)
function humanDelay(min = 300, max = 900) {
  return new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));
}

// O WEBSG NÃO redireciona a URL quando a sessão expira — ele apenas renderiza
// o formulário de login na própria URL pedida (ex: a listagem ou o snap de
// uma notícia podem devolver a tela de login mantendo a URL antiga na barra).
// Por isso a checagem correta é sempre pelo DOM (campo de senha), nunca pela URL.
async function isLoginPage(page) {
  try {
    return (await page.locator('input[type="password"]').count()) > 0;
  } catch (_) {
    return false;
  }
}

async function isLoggedIn(page) {
  try {
    await page.goto(NEWS_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    return !(await isLoginPage(page));
  } catch (_) {
    return false;
  }
}

// Preenche e envia o formulário de login na página atual (não navega para
// lugar nenhum antes — assume que o formulário já está visível na tela,
// seja na página inicial do WEBSG ou em qualquer URL que caiu de volta pro
// login por sessão expirada).
async function performLogin(page) {
  await humanDelay(400, 900);

  const userInput = page.locator('input[name="usuario"], input[type="text"]').first();
  await userInput.click();
  await humanDelay(200, 500);
  await userInput.fill('');
  await page.keyboard.type(process.env.WEBSG_USER, { delay: 60 });
  await humanDelay(300, 700);

  const passInput = page.locator('input[name="senha"], input[type="password"]').first();
  await passInput.click();
  await humanDelay(200, 400);
  await passInput.fill('');
  await page.keyboard.type(process.env.WEBSG_PASS, { delay: 70 });
  await humanDelay(400, 900);

  await page.locator('button[type="submit"], input[type="submit"], .btn-primary').first().click();
  // domcontentloaded, não networkidle — o painel tem widgets com polling em
  // segundo plano que nunca deixam a rede "ociosa", o que travava a espera
  // pelo tempo cheio do timeout toda vez.
  await page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});

  // Aguarda o form de login sumir em vez de checar uma vez após delay fixo —
  // o WEBSG às vezes demora mais que isso pra processar o POST, e a checagem
  // única dava falso negativo de "falha no login" mesmo com credenciais certas.
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && (await isLoginPage(page))) {
    await humanDelay(500, 900);
  }

  if (await isLoginPage(page)) {
    throw new Error('[auth] Falha no login — verifique WEBSG_USER/WEBSG_PASS no .env');
  }
}

async function login() {
  const page = await newPage();

  // Testa se já tem sessão ativa
  if (await isLoggedIn(page)) {
    console.log('[auth] Sessão ativa encontrada — pulando login');
  } else {
    console.log('[auth] Abrindo página de login...');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    await humanDelay(500, 1000);

    if (await isLoginPage(page)) {
      await performLogin(page);
      console.log('[auth] Login bem-sucedido! URL:', page.url());
      await saveSession();
    } else {
      console.log('[auth] Sessão ativa encontrada — pulando login');
    }
  }

  // Navega para lista de notícias clicando no seletor do painel (se ainda não estiver lá)
  if (!page.url().includes('frm=Listar')) {
    await humanDelay(600, 1200);
    console.log('[auth] Clicando em Gerenciar Notícias...');

    try {
      const newsLink = page.locator('#widget_boxs > div > div.panel-heading > div > a').first();
      await newsLink.waitFor({ state: 'visible', timeout: 10000 });
      await newsLink.click();
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
      console.log('[auth] Navegou para:', page.url());
    } catch (e) {
      // fallback: navegar direto pela URL
      console.log('[auth] Fallback: navegando direto para lista de notícias');
      await page.goto(NEWS_LIST_URL, { waitUntil: 'domcontentloaded' });
    }
  }

  return page;
}

// Garante que a página atual está autenticada. Se detectar o formulário de
// login (sessão caiu no meio do scraping), refaz o login na hora e navega de
// volta para `targetUrl` (a página que estava sendo raspada). Retorna true
// se precisou relogar (para o chamador saber que deve re-verificar o DOM).
async function ensureLoggedIn(page, targetUrl, gotoOpts = { waitUntil: 'domcontentloaded', timeout: 25000 }) {
  if (!(await isLoginPage(page))) return false;

  console.warn('[auth] ⚠ Sessão expirou durante o scraping — relogando...');
  await performLogin(page);
  await saveSession().catch(() => {});
  console.log('[auth] ✅ Relogado com sucesso — retomando navegação');

  if (targetUrl) {
    await page.goto(targetUrl, gotoOpts);
  }
  return true;
}

module.exports = { login, humanDelay, isLoginPage, performLogin, ensureLoggedIn };
