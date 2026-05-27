const { hasImageKitConfig, getUploadAuth } = require('../../src/models/imagekitModel');

module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  if (!hasImageKitConfig) {
    return res.status(500).json({ error: 'ImageKit is not configured on server.' });
  }

  const expire = Math.floor(Date.now() / 1000) + 60 * 10;
  const auth = getUploadAuth(expire);
  return res.status(200).json(auth);
};
