// Loads .env via config/env when the dependency graph initializes
require('./config/env');

const app = require('./app');
const { env } = require('./config/env');

const port = env.PORT;

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Gate Pass API listening on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`Base URL (from env): ${env.BASE_URL}`);
});
