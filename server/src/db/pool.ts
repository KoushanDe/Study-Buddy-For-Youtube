import pg from 'pg'

const { Pool } = pg

let pool: pg.Pool | null = null

function poolSslConfig(connectionString: string): pg.ConnectionConfig['ssl'] | undefined {
  if (process.env.DATABASE_SSL === 'false') return undefined

  const requiresSsl =
    process.env.DATABASE_SSL === 'true' ||
    /sslmode=(require|verify-full|verify-ca|prefer)/i.test(connectionString)

  if (!requiresSsl) return undefined

  // Managed Postgres (Render, Railway, etc.) uses certs Node won't verify by default.
  return { rejectUnauthorized: false }
}

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL is not configured')
    }
    pool = new Pool({
      connectionString,
      ssl: poolSslConfig(connectionString),
      max: Number(process.env.PG_POOL_MAX ?? 10),
      idleTimeoutMillis: Number(process.env.PG_POOL_IDLE_MS ?? 30_000),
      connectionTimeoutMillis: Number(process.env.PG_POOL_CONNECT_MS ?? 10_000),
    })
  }
  return pool
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
