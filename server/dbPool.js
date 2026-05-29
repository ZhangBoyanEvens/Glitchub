import pg from 'pg'

const { Pool } = pg

/**
 * Neon 建议用 pooled 连接串（*-pooler.*.neon.tech）。
 * @param {string} connectionString
 */
export function createDbPool(connectionString) {
  return new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX ?? 12),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 8_000),
    allowExitOnIdle: false,
  })
}
