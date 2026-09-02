// Renova o token de acesso do Instagram e regrava no .env.
// Rodar periodicamente (a cada ~30 dias) antes do token de 60 dias expirar.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { refreshToken } = require('../services/instagram');

async function main() {
  const data = await refreshToken();
  const envPath = path.join(__dirname, '..', '.env');
  const envContent = fs.readFileSync(envPath, 'utf8');
  const updated = envContent.replace(
    /INSTAGRAM_ACCESS_TOKEN=.*/,
    `INSTAGRAM_ACCESS_TOKEN=${data.access_token}`
  );
  fs.writeFileSync(envPath, updated);
  console.log('[refresh-instagram-token] .env atualizado com sucesso');
}

main().catch((err) => {
  console.error('[refresh-instagram-token] FALHOU:', err.message);
  process.exit(1);
});
