require('dotenv').config();
const path = require('path');
const os = require('os');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { uploadVideoToCloudinary } = require('./services/cloudinary');
const { postReelToInstagram } = require('./services/instagram');

const PORT = process.env.PORT || 3001;
const app = express();
app.use(cors());
app.get('/', (_, res) => res.json({ ok: true, service: 'painho-reel-api' }));

const uploadReel = multer({ dest: path.join(os.tmpdir(), 'painho-reels'), limits: { fileSize: 200 * 1024 * 1024 } });
app.post('/api/publish-reel', uploadReel.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'nenhum vídeo enviado (campo "video")' });
  const caption = req.body.caption || '';
  let collaborators = [];
  try { collaborators = req.body.collaborators ? JSON.parse(req.body.collaborators) : []; } catch { /* segue sem collab */ }
  try {
    const videoUrl = await uploadVideoToCloudinary(req.file.path, `reel_${Date.now()}`);
    const result = await postReelToInstagram(videoUrl, caption, collaborators);
    res.json({ ok: true, postId: result.id, videoUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

app.listen(PORT, () => console.log(`[painho-reel-api] rodando na porta ${PORT}`));
