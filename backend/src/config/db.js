const mysql = require('mysql2/promise');
const { env } = require('./env');

/**
 * Shared connection pool for the whole app.
 * mysql2/promise returns [rows, fields] from pool.execute().
 */
const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

/**
 * Run a query with placeholders: await query('SELECT * FROM visitors WHERE id = ?', [id])
 */
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

module.exports = { pool, query };
