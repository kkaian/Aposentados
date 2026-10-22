// Conexão direta com o Postgres do Supabase (só para scripts locais e CI)
// Usa SUPABASE_DB_URL (endereço completo, como na GitHub Action, ou o banco local sem SSL) ou SUPABASE_DB_PASSWORD (.env.local).
import pg from 'pg'

export const PROJECT_REF = 'sfbzyfgmdtbohnpnfsmu'

export async function connect() {
  const url = process.env.SUPABASE_DB_URL
  const password = process.env.SUPABASE_DB_PASSWORD
  if (!url && !password) throw new Error('Defina SUPABASE_DB_URL ou SUPABASE_DB_PASSWORD')
  const client = new pg.Client(
    url
      ? { connectionString: url, ssl: /@(127\.0\.0\.1|localhost)[:/]/.test(url) ? false : { rejectUnauthorized: false } }
      : {
          host: `db.${PROJECT_REF}.supabase.co`,
          port: 5432,
          user: 'postgres',
          database: 'postgres',
          password,
          ssl: { rejectUnauthorized: false },
        },
  )
  await client.connect()
  return client
}
