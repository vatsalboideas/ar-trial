const { IMAGE_TTL_MS } = require('../config/env');
const {
  hasImageKitConfig,
  getUploadAuth,
  deleteFileById,
} = require('../models/imagekitModel');

function getImageKitAuth(req, res) {
  if (!hasImageKitConfig) {
    return res.status(500).json({ error: 'ImageKit is not configured on server.' });
  }

  const expire = Math.floor(Date.now() / 1000) + 60 * 10;
  const auth = getUploadAuth(expire);
  return res.json(auth);
}

function scheduleDelete(req, res) {
  if (!hasImageKitConfig) {
    return res.status(500).json({ error: 'ImageKit is not configured on server.' });
  }

  const fileId = req.body?.fileId;
  if (!fileId || typeof fileId !== 'string') {
    return res.status(400).json({ error: 'fileId is required.' });
  }

  setTimeout(async () => {
    try {
      await deleteFileById(fileId);
      console.log(`[server] Deleted expired ImageKit file: ${fileId}`);
    } catch (err) {
      console.error(`[server] Failed to delete file ${fileId}:`, err?.message || err);
    }
  }, IMAGE_TTL_MS);

  return res.json({
    ok: true,
    fileId,
    deleteInMs: IMAGE_TTL_MS,
  });
}

module.exports = {
  getImageKitAuth,
  scheduleDelete,
};
