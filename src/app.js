const path = require('path');
const express = require('express');
const cors = require('cors');
const imagekitRoutes = require('./routes/imagekitRoutes');
const { hasImageKitConfig } = require('./models/imagekitModel');

const app = express();
const projectRoot = path.resolve(__dirname, '..');

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(projectRoot));

if (!hasImageKitConfig) {
  console.warn(
    '[server] Missing ImageKit env vars. Set IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, IMAGEKIT_URL_ENDPOINT.'
  );
}

app.use('/api/imagekit', imagekitRoutes);

app.use((req, res) => {
  res.sendFile(path.join(projectRoot, 'index.html'));
});

module.exports = app;
