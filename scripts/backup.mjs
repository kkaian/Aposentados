// Backup: exporta todas as tabelas do app em CSV para backup/<data>/.
// Roda na GitHub Action (a cada 3 dias), o que também mantém o Supabase ativo.
// Precisa de SUPABASE_DB_URL (pooler, IPv4) ou SUPABASE_DB_PASSWORD.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect } from './db.mjs'

const esc = (v) => {
  if (v == null) return ''
  const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const dir = join(import.meta.dirname, '..', 'backup', new Date().toISOString().slice(0, 10))
mkdirSync(dir, { recursive: true })

const db = await connect()
// Todas as tabelas do schema public, lidas do banco: tabela nova entra sozinha no backup
const { rows: tables } = await db.query(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`)
let total = 0
for (const { table_name: table } of tables) {
  const { rows, fields } = await db.query(`select * from public."${table}"`)
  const cols = fields.map((f) => f.name)
  writeFileSync(join(dir, `${table}.csv`), [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'))
  total += rows.length
  console.log(`${table}: ${rows.length}`)
}
await db.end()
console.log(`backup em ${dir} (${total} linhas)`)
