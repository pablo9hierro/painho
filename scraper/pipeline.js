const { login, humanDelay } = require('./auth');
const { uploadToCloudinary } = require('../services/cloudinary');
const { postToInstagram } = require('../services/instagram');
const fs = require('fs');
const path = require('path');

const LIST_URL = 'https://primeirasnoticias.com.br/websg/?p=noticias&frm=Listar';
const SNAP_BASE = 'https://primeirasnoticias.com.br/websg/?p=pluginsocialsnap&frm=Formulario&acao=noticias&id=';
const STATE_FILE = path.join(__dirname, '..', 'state', 'processed.json');

// ── State management ──────────────────────────────────

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch (_) {}
  return { processed: [] };
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── Scrape news list ──────────────────────────────────

async function scrapeNewsList(page) {
  await page.goto(LIST_URL, { waitUntil: 'networkidle' });
  await humanDelay(500, 900);

  const tableBase = '#main_content > div.row > div > form > div:nth-child(1) > table > tbody';
  await page.locator(tableBase).waitFor({ state: 'visible', timeout: 15000 });

  const rows = await page.locator(`${tableBase} > tr`).all();
  const items = [];

  for (const row of rows) {
    // Only rows that have a numeric ID label
    const idEl = row.locator('.label.label-primary2, .label-primary2');
    if ((await idEl.count()) === 0) continue;

    const idText = (await idEl.first().innerText()).trim();
    const id = parseInt(idText);
    if (isNaN(id)) continue;

    // Public article URL (opens in new tab when clicked)
    const titleEl = row.locator('td:nth-child(2) a').first();
    const articleUrl = await titleEl.getAttribute('href');
    const title = (await titleEl.innerText()).trim();

    items.push({ id, title, articleUrl });
  }

  return items;
}

// ── Scrape article paragraph ──────────────────────────

async function scrapeArticleParagraph(ctx, articleUrl) {
  const tab = await ctx.newPage();
  try {
    const url = articleUrl.startsWith('http')
      ? articleUrl
      : `https://primeirasnoticias.com.br${articleUrl}`;

    await tab.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    let text = '';

    // Try specific selector first
    const specific = tab.locator('#texto_release_format > p:nth-child(4)');
    if ((await specific.count()) > 0) {
      text = (await specific.innerText()).trim();
    }

    // Fallback: first non-empty paragraph
    if (!text) {
      const all = await tab.locator('#texto_release_format p').all();
      for (const p of all) {
        const t = (await p.innerText()).trim();
        if (t.length > 30) { text = t; break; }
      }
    }

    // Last resort: any visible text block
    if (!text) {
      const block = tab.locator('#texto_release_format').first();
      if ((await block.count()) > 0) {
        text = (await block.innerText()).trim().split('\n').find(l => l.length > 30) || '';
      }
    }

    return text;
  } finally {
    await tab.close();
  }
}

// ── Get snap image ────────────────────────────────────

async function getSnapImage(ctx, newsId) {
  const snapUrl = `${SNAP_BASE}${newsId}`;
  const tab = await ctx.newPage();

  try {
    await tab.goto(snapUrl, { waitUntil: 'networkidle', timeout: 25000 });
    await humanDelay(1500, 2500);

    // Click the already-selected template to ensure preview is fresh
    const selectedTpl = tab.locator('#ss-template-list > a.list-group-item.is-selected');
    if ((await selectedTpl.count()) > 0) {
      await selectedTpl.click();
      await humanDelay(1200, 2000);
    }

    // Wait for canvas to render
    await tab.locator('#ss-canvas').waitFor({ state: 'visible', timeout: 12000 });
    await humanDelay(800, 1200);

    // Intercept the PNG download (full 1080×1080 quality)
    const UPLOADS = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

    const tmpPath = path.join(UPLOADS, `snap_${newsId}_${Date.now()}.png`);

    const dlPromise = tab.waitForEvent('download', { timeout: 25000 });
    await tab.locator('a[data-click="downloadPng"], .ss-download-btn').first().click();
    const dl = await dlPromise;
    await dl.saveAs(tmpPath);

    console.log(`[pipeline] Imagem salva: ${tmpPath}`);
    return tmpPath;

  } finally {
    await tab.close();
  }
}

// ── Main pipeline ─────────────────────────────────────

async function runPipeline({ dryRun = false, limit = 0 } = {}) {
  const state = loadState();
  const page = await login();
  const ctx = page.context();

  console.log('[pipeline] Buscando lista de notícias...');
  const items = await scrapeNewsList(page);

  // Filter unprocessed, process from oldest (lowest ID) to newest
  let toProcess = items
    .filter(item => !state.processed.includes(item.id))
    .sort((a, b) => a.id - b.id);

  if (limit > 0) toProcess = toProcess.slice(0, limit);
  console.log(`[pipeline] ${toProcess.length} notícias para processar`);

  const results = [];

  for (const item of toProcess) {
    console.log(`\n[pipeline] ── ID ${item.id}: ${item.title}`);

    try {
      // 1. Get first paragraph from public article
      const paragraph = await scrapeArticleParagraph(ctx, item.articleUrl);
      console.log(`[pipeline] Parágrafo: "${paragraph.substring(0, 80)}..."`);

      // 2. Download social snap image (1080×1080)
      const imagePath = await getSnapImage(ctx, item.id);

      if (dryRun) {
        console.log('[pipeline] DRY RUN — pulando Cloudinary e Instagram');
        if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
        state.processed.push(item.id);
        saveState(state);
        results.push({ id: item.id, title: item.title, success: true, dryRun: true });
        continue;
      }

      // 3. Upload image to Cloudinary (gera URL pública permanente)
      const imageUrl = await uploadToCloudinary(imagePath, `pn_${item.id}`);
      console.log(`[pipeline] Cloudinary: ${imageUrl}`);
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);

      // 4. Post to Instagram
      const caption = buildCaption(item.title, paragraph);
      const igPost = await postToInstagram(imageUrl, caption);
      console.log(`[pipeline] Instagram post ID: ${igPost.id}`);

      state.processed.push(item.id);
      saveState(state);
      results.push({ id: item.id, title: item.title, success: true, igPostId: igPost.id, imageUrl });

      // Delay entre posts para não estourar rate limit
      await humanDelay(8000, 15000);

    } catch (err) {
      console.error(`[pipeline] Erro ID ${item.id}: ${err.message}`);
      results.push({ id: item.id, title: item.title, success: false, error: err.message });
    }
  }

  return results;
}

function buildCaption(title, paragraph) {
  return `${title}\n\n${paragraph}\n\nLink na bio.\n`;
}

module.exports = {
  runPipeline,
  scrapeNewsList,
  scrapeArticleParagraph,
  getSnapImage,
  loadState,
  saveState,
  buildCaption,
};
