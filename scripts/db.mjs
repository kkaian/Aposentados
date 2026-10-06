// Conexão direta com o Postgres do Supabase (só para scripts locais e CI)
// Lê SUPABASE_DB_PASSWORD do .env.local (node --env-file) ou do ambiente.
import pg from 'pg'

export const PROJECT_REF = 'sfbzyfgmdtbohnpnfsmu'

export async function connect() {
  const password = process.env.SUPABASE_DB_PASSWORD
  if (!password) throw new Error('Defina SUPABASE_DB_PASSWORD (no .env.local ou no ambiente)')
  const client = new pg.Client({
    connectionString: process.env.SUPABASE_DB_URL,
    host: process.env.SUPABASE_DB_URL ? undefined : `db.${PROJECT_REF}.supabase.co`,
    port: 5432,
    user: 'postgres',
    database: 'postgres',
    password,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  return client
}
