const path = require('path');

// Load variables from backend/.env (one folder above src/)
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '5000', 10),
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: parseInt(process.env.DB_PORT || '3306', 10),
  DB_USER: process.env.DB_USER || 'root',
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  DB_NAME: process.env.DB_NAME || 'gatepass_automation',
  BASE_URL: (process.env.BASE_URL || 'http://localhost:5000').replace(/\/$/, ''),
};

module.exports = { env };
