// Aplica as migrações de supabase/migrations que ainda não rodaram.
// Usa a mesma tabela de controle do Supabase CLI (supabase_migrations.schema_migrations).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect } from './db.mjs'

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations')
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()

const db = await connect()
await db.query(`create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`)
const applied = new Set((await db.query('select version from supabase_migrations.schema_migrations')).rows.map((r) => r.version))

// --baseline=VERSAO: marca como aplicadas, sem rodar, as migrações até VERSAO (banco já tem a estrutura)
const baselineUntil = process.argv.find((a) => a.startsWith('--baseline='))?.split('=')[1]

for (const file of files) {
  const [version, ...rest] = file.replace('.sql', '').split('_')
  if (applied.has(version)) continue
  const baseline = baselineUntil && version <= baselineUntil
  const sql = readFileSync(join(dir, file), 'utf8')
  try {
    await db.query('begin')
    if (!baseline) await db.query(sql)
    await db.query('insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)', [version, rest.join('_'), [sql]])
    await db.query('commit')
    console.log(baseline ? 'marcada' : 'aplicada', file)
  } catch (e) {
    await db.query('rollback')
    console.error(`ERRO em ${file}: ${e.message}`)
    process.exitCode = 1
    break
  }
}
await db.end()
