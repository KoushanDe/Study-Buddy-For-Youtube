import 'dotenv/config'
import { runMigrations } from './migrate.js'
import { closePool } from './pool.js'

async function main(): Promise<void> {
  await runMigrations()
  console.log('Migrations complete')
  await closePool()
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
