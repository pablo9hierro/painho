const { login, humanDelay } = require('./auth');
const { newPage } = require('./browser');
const path = require('path');
const fs = require('fs');

const NEW_NEWS_URL = 'https://primeirasnoticias.com.br/websg/?p=noticias&frm=Adicionar';

/**
 * Posta uma notícia na plataforma.
 * @param {Object} data
 * @param {string} data.title       - Título da notícia
 * @param {string} data.description - Corpo/descrição
 * @param {string} data.category    - Categoria (ex: "Policial")
 * @param {string} [data.imagePath] - Caminho local da imagem (opcional)
 */
async function postNews(data) {
  const page = await login();

  console.log('[news] Navegando para adicionar notícia...');
  await page.goto(NEW_NEWS_URL, { waitUntil: 'networkidle' });
  await humanDelay(600, 1000);

  // Título
  const titleInput = page.locator('input[name="titulo"], #titulo').first();
  await titleInput.click();
  await page.keyboard.type(data.title, { delay: 55 });
  await humanDelay(300, 700);

  // Descrição (pode ser um textarea ou TinyMCE/CKEditor)
  try {
    // Tenta editor rico (iframe TinyMCE)
    const editorFrame = page.frameLocator('#texto_ifr, iframe[id*="ifr"]').first();
    const editorBody = editorFrame.locator('body');
    await editorBody.click();
    await editorBody.fill(data.description);
  } catch (_) {
    // Fallback textarea
    const textarea = page.locator('textarea[name="texto"], #texto').first();
    await textarea.click();
    await textarea.fill(data.description);
  }
  await humanDelay(400, 800);

  // Categoria (select)
  if (data.category) {
    const catSelect = page.locator('select[name="categoria"], #categoria').first();
    await catSelect.selectOption({ label: data.category });
    await humanDelay(300, 600);
  }

  // Upload de imagem
  if (data.imagePath && fs.existsSync(data.imagePath)) {
    console.log('[news] Fazendo upload da imagem:', data.imagePath);
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(data.imagePath);
    await humanDelay(800, 1500);
  }

  // Salvar/Publicar
  const saveBtn = page.locator('button[type="submit"], input[name="salvar"], .btn-success').first();
  await saveBtn.click();
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 });

  const finalUrl = page.url();
  console.log('[news] Notícia postada! URL final:', finalUrl);
  return { success: true, url: finalUrl };
}

/**
 * Lista as notícias existentes
 */
async function listNews() {
  const page = await login();
  await page.waitForSelector('table tbody tr, .table tbody tr', { timeout: 10000 });

  const rows = await page.locator('table tbody tr').all();
  const news = [];

  for (const row of rows) {
    const cells = await row.locator('td').all();
    if (cells.length >= 3) {
      news.push({
        id: await cells[0].innerText(),
        title: await cells[1].innerText(),
        category: await cells[2].innerText(),
      });
    }
  }

  return news;
}

module.exports = { postNews, listNews };
