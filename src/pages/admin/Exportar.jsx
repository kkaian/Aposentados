import { Download } from 'lucide-react'
import { useState } from 'react'
import { AdminBadge, Notice } from '../../components/ui'
import { friendlyError } from '../../lib/errors'
import { supabase } from '../../lib/supabase'

// CSV com ";" (abre direto no Excel em português) e BOM para os acentos
function toCSV(rows) {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const esc = (v) => {
    if (v == null) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\n')
}

function download(name, rows) {
  const blob = new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `aposentados-${name}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

async function all(table, select = '*') {
  const { data, error } = await supabase.from(table).select(select)
  if (error) throw error
  return data ?? []
}

const EXPORTS = [
  ['jogadores', 'Jogadores', async () => (await all('profiles', 'name, username, role, type, status, created_at')).map((p) => ({ nome: p.name, usuario: p.username, papel: p.role, tipo: p.type, status: p.status, desde: p.created_at }))],
  ['estatisticas', 'Estatísticas do mês', async () => {
    const [stats, people] = await Promise.all([all('player_month_stats'), all('profiles', 'id, name')])
    const name = Object.fromEntries(people.map((p) => [p.id, p.name]))
    return stats.map((s) => ({ mes: s.month, jogador: name[s.profile_id], jogos: s.games, vitorias: s.wins, gols: s.goals, assistencias: s.assists, total: s.total }))
  }],
  ['peladas', 'Peladas', () => all('peladas', 'date, start_time, location, max_slots, status')],
  ['jogos', 'Jogos e placares', async () => {
    const [scores, games] = await Promise.all([all('game_scores'), all('games', 'id, number, status, started_at, ended_at')])
    const g = Object.fromEntries(games.map((x) => [x.id, x]))
    return scores.map((s) => ({ pelada: s.pelada_id, jogo: g[s.game_id]?.number, time1: s.team1_id, gols1: s.team1_goals, gols2: s.team2_goals, time2: s.team2_id, status: g[s.game_id]?.status, inicio: g[s.game_id]?.started_at }))
  }],
  ['eventos', 'Eventos (gols, cartões, substituições)', async () => {
    const [events, people, guests] = await Promise.all([all('game_events'), all('profiles', 'id, name'), all('guests', 'id, name')])
    const p = Object.fromEntries(people.map((x) => [x.id, x.name]))
    const g = Object.fromEntries(guests.map((x) => [x.id, x.name]))
    const who = (pid, gid) => (pid ? p[pid] : gid ? `${g[gid]} (avulso)` : '')
    return events.map((e) => ({ jogo: e.game_id, minuto: e.minute, tipo: e.type, jogador: who(e.player_id, e.player_guest_id), assistencia: who(e.assist_id, e.assist_guest_id), entrou: who(e.sub_in_id, e.sub_in_guest_id) }))
  }],
  ['pagamentos', 'Pagamentos', async () => {
    const [charges, payments, people] = await Promise.all([all('charges'), all('payments'), all('profiles', 'id, name')])
    const c = Object.fromEntries(charges.map((x) => [x.id, x]))
    const p = Object.fromEntries(people.map((x) => [x.id, x.name]))
    return payments.map((x) => ({ cobranca: c[x.charge_id]?.kind === 'mensalidade' ? `Mensalidade ${c[x.charge_id].month}` : c[x.charge_id]?.title, valor: c[x.charge_id]?.amount, jogador: p[x.profile_id], status: x.status, informado: x.informed_at, confirmado: x.confirmed_at }))
  }],
]

export default function Exportar() {
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState({})

  async function run(key, label, fn) {
    setBusy(key)
    setMsg({})
    try {
      const rows = await fn()
      if (!rows.length) setMsg({ error: `${label}: nada para exportar ainda.` })
      else download(key, rows)
    } catch (err) {
      setMsg({ error: friendlyError(err) })
    }
    setBusy(null)
  }

  return (
    <div className="pb-6">
      <div className="flex justify-end px-4 pt-3">
        <AdminBadge />
      </div>
      <p className="px-4 pt-1 text-sm text-muted">Planilhas CSV que abrem no Excel ou no Google Planilhas. Além disso, um backup completo é feito sozinho a cada 3 dias.</p>
      <div className="space-y-2 px-4 pt-4">
        {EXPORTS.map(([key, label, fn]) => (
          <button key={key} className="btn-ghost flex h-12 w-full items-center gap-3 text-left" disabled={busy !== null} onClick={() => run(key, label, fn)}>
            <Download size={18} className="text-action" />
            <span className="flex-1">{label}</span>
            {busy === key && <span className="text-xs text-muted">gerando…</span>}
          </button>
        ))}
        <Notice>{msg.error}</Notice>
      </div>
    </div>
  )
}
