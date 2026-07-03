const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

async function uploadToCloudinary(filePath, publicId) {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      public_id: publicId,
      folder: 'primeirasnoticias',
      overwrite: true,
      resource_type: 'image',
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

async function pingCloudinary() {
  const result = await cloudinary.api.ping();
  return result.status === 'ok';
}

module.exports = { uploadToCloudinary, pingCloudinary };
