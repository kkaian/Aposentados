// Backup: exporta todas as tabelas do app em CSV para backup/<data>/.
// Roda na GitHub Action (a cada 3 dias), o que também mantém o Supabase ativo.
// Precisa de SUPABASE_DB_URL (pooler, IPv4) ou SUPABASE_DB_PASSWORD.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect } from './db.mjs'

const TABLES = [
  'profiles', 'invites', 'password_requests', 'app_settings', 'kits', 'kit_suggestions',
  'peladas', 'pelada_helpers', 'pelada_diaristas', 'guests', 'presence',
  'teams', 'team_members', 'drafts', 'games', 'game_lineup', 'game_events',
  'ratings', 'charges', 'payments', 'cash_entries',
]

const esc = (v) => {
  if (v == null) return ''
  const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const dir = join(import.meta.dirname, '..', 'backup', new Date().toISOString().slice(0, 10))
mkdirSync(dir, { recursive: true })

const db = await connect()
let total = 0
for (const table of TABLES) {
  const { rows, fields } = await db.query(`select * from public.${table}`)
  const cols = fields.map((f) => f.name)
  writeFileSync(join(dir, `${table}.csv`), [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'))
  total += rows.length
  console.log(`${table}: ${rows.length}`)
}
await db.end()
console.log(`backup em ${dir} (${total} linhas)`)
