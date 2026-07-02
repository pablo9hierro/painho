require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { login } = require('./scraper/auth');
const { postNews, listNews } = require('./scraper/news');
const { closeBrowser } = require('./scraper/browser');

const app = express();
const PORT = process.env.PORT || 3001;

// Pasta de uploads temporários
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

const upload = multer({ dest: UPLOADS_DIR });

app.use(cors());
app.use(express.json());

// ── Rotas ──────────────────────────────────────────────

// GET /health — verifica se o servidor está rodando
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// POST /login — testa login e salva sessão
app.post('/login', async (req, res) => {
  try {
    await login();
    res.json({ success: true, message: 'Login realizado com sucesso' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /noticias — lista notícias existentes
app.get('/noticias', async (req, res) => {
  try {
    const news = await listNews();
    res.json({ success: true, data: news });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /noticias — posta nova notícia (com ou sem imagem)
// Body: { title, description, category }
// File (optional): imagem
app.post('/noticias', upload.single('imagem'), async (req, res) => {
  try {
    const { title, description, category } = req.body;

    if (!title || !description) {
      return res.status(400).json({ success: false, error: 'title e description são obrigatórios' });
    }

    const imagePath = req.file ? req.file.path : null;

    const result = await postNews({ title, description, category, imagePath });

    // Remove imagem temporária após upload
    if (imagePath && fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /shutdown — fecha o browser e encerra o servidor
app.post('/shutdown', async (req, res) => {
  res.json({ success: true, message: 'Encerrando...' });
  await closeBrowser();
  process.exit(0);
});

// ── Start ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Servidor painho rodando em http://localhost:${PORT}`);
  console.log(`   POST /login       → faz login na plataforma`);
  console.log(`   GET  /noticias    → lista notícias`);
  console.log(`   POST /noticias    → posta nova notícia`);
  console.log(`   POST /shutdown    → encerra o servidor\n`);
});

process.on('SIGINT', async () => {
  console.log('\n[server] Encerrando...');
  await closeBrowser();
  process.exit(0);
});
