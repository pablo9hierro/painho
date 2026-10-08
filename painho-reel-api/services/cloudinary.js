const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name:        process.env.CLOUDINARY_CLOUD_NAME,
  api_key:           process.env.CLOUDINARY_API_KEY,
  api_secret:        process.env.CLOUDINARY_API_SECRET,
  secure:            true,
  signature_version: 1,  // SDK v2 usa v2 por padrão (URL-encoded), mas contas novas esperam v1
});

async function uploadToCloudinary(filePath, publicId) {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      public_id: publicId,
      folder: 'primeirasnoticias',
      overwrite: true,
      resource_type: 'image',
      // O snap sai em PNG com canal alfa (transparência), e a API do Instagram
      // rejeita isso com o erro 9004 "Only photo or video can be accepted".
      // Converte pra JPG (sem alfa) achatando num fundo branco.
      format: 'jpg',
      background: 'white',
      flags: 'lossy',
    });
    return result.secure_url;
  } catch (err) {
    // Log completo para diagnóstico
    const code    = err.http_code || err.code || '?';
    const detail  = err.message || (err.error && JSON.stringify(err.error)) || String(err);
    console.error(`[cloudinary] HTTP ${code}: ${detail}`);
    throw new Error(`Cloudinary ${code}: ${detail}`);
  }
}

async function uploadVideoToCloudinary(filePath, publicId) {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      public_id: publicId,
      folder: 'primeirasnoticias/reels',
      overwrite: true,
      resource_type: 'video',
    });
    return result.secure_url;
  } catch (err) {
    const code    = err.http_code || err.code || '?';
    const detail  = err.message || (err.error && JSON.stringify(err.error)) || String(err);
    console.error(`[cloudinary] HTTP ${code}: ${detail}`);
    throw new Error(`Cloudinary ${code}: ${detail}`);
  }
}

async function deleteFromCloudinary(publicId) {
  // publicId aqui é o caminho completo: 'primeirasnoticias/pn_XXXXX'
  const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
  return result.result; // 'ok' | 'not found'
}

async function pingCloudinary() {
  const result = await cloudinary.api.ping();
  return result.status === 'ok';
}

module.exports = { uploadToCloudinary, uploadVideoToCloudinary, deleteFromCloudinary, pingCloudinary };
