const app = require('./src/app');
const { PORT } = require('./src/config/env');

app.listen(PORT, () => {
  console.log(`[server] Running at http://localhost:${PORT}`);
});
