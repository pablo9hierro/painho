const { chromium } = require('patchright');
const path = require('path');

let browserInstance = null;
let contextInstance = null;

const STEALTH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-zygote',
  '--disable-gpu',
  '--lang=pt-BR,pt',
  '--window-size=1366,768',
];

async function getBrowser(headless = false) {
  if (browserInstance) return browserInstance;

  browserInstance = await chromium.launch({
    headless,
    channel: 'chrome', // usa o Chrome instalado no sistema
    args: STEALTH_ARGS,
    ignoreDefaultArgs: ['--enable-automation'],
  });

  return browserInstance;
}

async function getContext() {
  if (contextInstance) return contextInstance;

  const browser = await getBrowser(process.env.HEADLESS === 'true');

  contextInstance = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: 'pt-BR',
    timezoneId: 'America/Fortaleza',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    extraHTTPHeaders: {
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    },
    storageState: _loadSession(),
  });

  // Remove sinais de automação via JS
  await contextInstance.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en'] });
    window.chrome = { runtime: {} };
  });

  return contextInstance;
}

async function newPage() {
  const ctx = await getContext();
  const page = await ctx.newPage();

  // Delay humano em cliques e digitação
  page.setDefaultTimeout(30000);
  return page;
}

async function saveSession() {
  if (!contextInstance) return;
  const state = await contextInstance.storageState();
  require('fs').writeFileSync(
    path.join(__dirname, '..', 'session.json'),
    JSON.stringify(state, null, 2)
  );
  console.log('[browser] Sessão salva em session.json');
}

async function closeBrowser() {
  if (contextInstance) await contextInstance.close();
  if (browserInstance) await browserInstance.close();
  contextInstance = null;
  browserInstance = null;
}

function _loadSession() {
  try {
    const p = path.join(__dirname, '..', 'session.json');
    if (require('fs').existsSync(p)) {
      console.log('[browser] Carregando sessão salva...');
      return JSON.parse(require('fs').readFileSync(p, 'utf-8'));
    }
  } catch (_) {}
  return undefined;
}

module.exports = { getBrowser, getContext, newPage, saveSession, closeBrowser };
