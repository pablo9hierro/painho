require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { login } = require('./scraper/auth');
const { runPipeline, scrapeNewsList, loadState } = require('./scraper/pipeline');
const { refreshToken, getMyUserId } = require('./services/instagram');
const { closeBrowser } = require('./scraper/browser');

const app = express();
const PORT = process.env.PORT || 3001;

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

app.use(cors());
app.use(express.json());

// ── Health ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── Login ──────────────────────────────────────────────
app.post('/login', async (req, res) => {
  try {
    await login();
    res.json({ success: true, message: 'Login realizado com sucesso' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── News list (scraping) ───────────────────────────────
// GET /noticias/lista — lista todas as notícias da plataforma + quais já foram processadas
app.get('/noticias/lista', async (req, res) => {
  try {
    const page = await login();
    const items = await scrapeNewsList(page);
    const state = loadState();
    const withStatus = items.map(i => ({
      ...i,
      processed: state.processed.includes(i.id),
    }));
    res.json({ success: true, total: items.length, data: withStatus });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Pipeline ───────────────────────────────────────────
// POST /pipeline/run — roda o pipeline completo (scraping + Cloudinary + Instagram)
// Body opcional: { dryRun: true, limit: 5 }
app.post('/pipeline/run', async (req, res) => {
  const { dryRun = false, limit = 0 } = req.body || {};

  // Responde imediatamente para não dar timeout
  res.json({ success: true, message: 'Pipeline iniciado — acompanhe os logs no terminal' });

  try {
    const results = await runPipeline({ dryRun, limit });
    console.log('\n[server] Pipeline concluído:', JSON.stringify(results, null, 2));
  } catch (err) {
    console.error('[server] Pipeline falhou:', err.message);
  }
});

// POST /pipeline/dry-run — testa sem postar no Instagram
app.post('/pipeline/dry-run', async (req, res) => {
  const { limit = 3 } = req.body || {};
  try {
    const results = await runPipeline({ dryRun: true, limit });
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /pipeline/state — mostra quais IDs já foram processados
app.get('/pipeline/state', (req, res) => {
  res.json({ success: true, state: loadState() });
});

// DELETE /pipeline/state — reseta o estado (reprocessa tudo)
app.delete('/pipeline/state', (req, res) => {
  const STATE = path.join(__dirname, 'state', 'processed.json');
  if (fs.existsSync(STATE)) fs.unlinkSync(STATE);
  res.json({ success: true, message: 'Estado resetado' });
});

// ── Instagram ──────────────────────────────────────────
// GET /instagram/me — retorna o User ID da conta autenticada
app.get('/instagram/me', async (req, res) => {
  try {
    const data = await getMyUserId();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /instagram/refresh-token — renova o access token por mais 60 dias
app.post('/instagram/refresh-token', async (req, res) => {
  try {
    const data = await refreshToken();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Shutdown ───────────────────────────────────────────
app.post('/shutdown', async (req, res) => {
  res.json({ success: true, message: 'Encerrando...' });
  await closeBrowser();
  process.exit(0);
});

// ── Start ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n Servidor painho em http://localhost:${PORT}`);
  console.log(`  POST /login                  → login na plataforma`);
  console.log(`  GET  /noticias/lista         → lista notícias + status de processamento`);
  console.log(`  POST /pipeline/run           → roda pipeline completo`);
  console.log(`  POST /pipeline/dry-run       → testa sem postar no Instagram`);
  console.log(`  GET  /pipeline/state         → IDs já processados`);
  console.log(`  DELETE /pipeline/state       → reseta estado`);
  console.log(`  GET  /instagram/me           → mostra o User ID do Instagram`);
  console.log(`  POST /instagram/refresh-token → renova token por 60 dias\n`);
});

process.on('SIGINT', async () => {
  console.log('\n[server] Encerrando...');
  await closeBrowser();
  process.exit(0);
});
