// Script de teste rápido — roda sem servidor
// node test-login.js
require('dotenv').config();
const { login } = require('./scraper/auth');
const { closeBrowser } = require('./scraper/browser');

(async () => {
  try {
    console.log('Iniciando teste de login...');
    const page = await login();
    console.log('URL final:', page.url());
    console.log('\nTeste bem-sucedido! Pressione Ctrl+C para fechar.');
    // Mantém aberto 10s para ver o resultado
    await new Promise((r) => setTimeout(r, 10000));
  } catch (err) {
    console.error('Erro:', err.message);
  } finally {
    await closeBrowser();
    process.exit(0);
  }
})();
