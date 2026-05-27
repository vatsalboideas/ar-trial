const ImageKit = require('@imagekit/nodejs');
const {
  IMAGEKIT_PUBLIC_KEY,
  IMAGEKIT_PRIVATE_KEY,
  IMAGEKIT_URL_ENDPOINT,
} = require('../config/env');

const hasImageKitConfig =
  Boolean(IMAGEKIT_PUBLIC_KEY) &&
  Boolean(IMAGEKIT_PRIVATE_KEY) &&
  Boolean(IMAGEKIT_URL_ENDPOINT);

const imagekit = hasImageKitConfig
  ? new ImageKit({
      privateKey: IMAGEKIT_PRIVATE_KEY,
    })
  : null;

function getUploadAuth(expire) {
  if (!imagekit) return null;
  const auth = imagekit.helper.getAuthenticationParameters(undefined, expire);
  return {
    publicKey: IMAGEKIT_PUBLIC_KEY,
    signature: auth.signature,
    token: auth.token,
    expire: auth.expire,
  };
}

async function deleteFileById(fileId) {
  if (!imagekit) return false;
  await imagekit.files.delete(fileId);
  return true;
}

module.exports = {
  hasImageKitConfig,
  getUploadAuth,
  deleteFileById,
};
