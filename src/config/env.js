const dotenv = require('dotenv');

dotenv.config();

function normalizeEnv(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

const PORT = Number(process.env.PORT || 3000);
const IMAGEKIT_PUBLIC_KEY = normalizeEnv(process.env.IMAGEKIT_PUBLIC_KEY);
const IMAGEKIT_PRIVATE_KEY = normalizeEnv(process.env.IMAGEKIT_PRIVATE_KEY);
const IMAGEKIT_URL_ENDPOINT = normalizeEnv(process.env.IMAGEKIT_URL_ENDPOINT);
const IMAGE_TTL_MS = Number(process.env.IMAGE_TTL_MS || 30 * 60 * 1000);

module.exports = {
  PORT,
  IMAGEKIT_PUBLIC_KEY,
  IMAGEKIT_PRIVATE_KEY,
  IMAGEKIT_URL_ENDPOINT,
  IMAGE_TTL_MS,
};
