import { Shuffle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Avatar from '../../components/Avatar'
import { AdminBadge, Notice, SectionLabel, Segmented, Spinner } from '../../components/ui'
import { TEAM_COLORS } from '../../lib/constants'
import { dayLabel } from '../../lib/dates'
import { friendlyError } from '../../lib/errors'
import { fetchActivePlayers, fetchCurrentPelada } from '../../lib/peladas'
import { photoUrl } from '../../lib/storage'
import { supabase } from '../../lib/supabase'

const fmt = (v) => (v == null ? '–' : Number(v).toFixed(1).replace('.', ','))

function shuffle(list) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Equilibrado: ordena pelo overall e distribui em "vai e volta"; sem nota conta como 3
function draw(players, n, balance) {
  const teams = Array.from({ length: n }, () => [])
  const ordered = balance ? shuffle(players).sort((a, b) => (b.overall ?? 3) - (a.overall ?? 3)) : shuffle(players)
  ordered.forEach((p, i) => {
    const round = Math.floor(i / n)
    const pos = i % n
    teams[round % 2 === 0 ? pos : n - 1 - pos].push(p)
  })
  return teams
}

const avg = (team) => {
  const rated = team.filter((p) => p.overall != null)
  return rated.length ? rated.reduce((s, p) => s + Number(p.overall), 0) / rated.length : null
}

export default function Sorteio() {
  const navigate = useNavigate()
  const [pelada, setPelada] = useState()
  const [players, setPlayers] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [showAll, setShowAll] = useState(false)
  const [n, setN] = useState('2')
  const [balance, setBalance] = useState(true)
  const [result, setResult] = useState(null)
  const [swap, setSwap] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      const p = await fetchCurrentPelada()
      setPelada(p ?? null)
      if (!p) return
      const [all, { data: pres }, { data: ratings }] = await Promise.all([
        fetchActivePlayers(),
        supabase.from('presence_list').select('profile_id, answer, waitlisted').eq('pelada_id', p.id),
        supabase.from('rating_summary').select('profile_id, overall'),
      ])
      const overall = Object.fromEntries((ratings ?? []).map((r) => [r.profile_id, r.overall]))
      const going = new Set((pres ?? []).filter((r) => r.answer === 'vou' && !r.waitlisted).map((r) => r.profile_id))
      setPlayers(all.map((x) => ({ ...x, overall: overall[x.id], going: going.has(x.id) })))
      setSelected(going)
    })()
  }, [])

  if (pelada === undefined) return <Spinner />
  if (!pelada) return <div className="p-6 text-center text-muted">Nenhuma pelada marcada.</div>

  const chosen = players.filter((p) => selected.has(p.id))

  function toggle(id) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // toque num jogador e depois em outro (de outro time) para trocar
  function tap(t, i) {
    if (!swap) return setSwap({ t, i })
    if (swap.t !== t) {
      setResult((r) => {
        const next = r.map((team) => [...team])
        ;[next[swap.t][swap.i], next[t][i]] = [next[t][i], next[swap.t][swap.i]]
        return next
      })
    }
    setSwap(null)
  }

  async function confirm() {
    setBusy(true)
    setError('')
    const { error } = await supabase.rpc('save_sorteio', { p_pelada: pelada.id, p_teams: result.map((t) => t.map((p) => p.id)) })
    setBusy(false)
    if (error) setError(friendlyError(error))
    else navigate('/times')
  }

  if (result) {
    const selectedName = swap ? result[swap.t][swap.i].name : null
    return (
      <div className="pb-6">
        <div className="flex justify-end px-4 pt-3">
          <AdminBadge />
        </div>
        <p className="px-4 text-sm text-muted">
          {balance ? 'Sorteio equilibrado pelo overall.' : 'Sorteio livre.'} Toque em um jogador e depois em outro para trocar de time.
        </p>
        {result.map((team, t) => (
          <div key={t}>
            <div className="flex items-center gap-2 px-4 pt-4 pb-1">
              <span className="h-3 w-3 rounded-full" style={{ background: TEAM_COLORS[t].hex }} />
              <b className="flex-1">Time {TEAM_COLORS[t].name}</b>
              <span className="text-xs text-muted">Overall médio {fmt(avg(team))}</span>
            </div>
            {team.map((p, i) => (
              <button
                key={p.id}
                onClick={() => tap(t, i)}
                className={`flex min-h-12 w-full items-center gap-3 border-b border-row px-4 text-left ${swap?.t === t && swap?.i === i ? 'bg-action/15' : ''}`}
              >
                <Avatar name={p.name} src={photoUrl(p.photo_path)} size={32} />
                <span className="flex-1">{p.name}</span>
                <span className="text-xs text-muted">overall {fmt(p.overall)}</span>
              </button>
            ))}
          </div>
        ))}
        {selectedName && <div className="px-4 pt-3 text-sm text-action">Selecionado: {selectedName}. Escolha com quem trocar.</div>}
        <div className="space-y-2 px-4 pt-4">
          <Notice>{error}</Notice>
          <button className="btn w-full" disabled={busy} onClick={confirm}>
            Confirmar times
          </button>
          <button className="btn-ghost flex w-full items-center justify-center gap-2" onClick={() => setResult(draw(chosen, Number(n), balance))}>
            <Shuffle size={16} /> Sortear de novo
          </button>
          <p className="text-xs text-muted">Confirmar substitui os times desta pelada (a escolha dos capitães, se houver).</p>
        </div>
      </div>
    )
  }

  const list = showAll ? players : players.filter((p) => p.going || selected.has(p.id))

  return (
    <div className="pb-6">
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="text-sm text-muted">{dayLabel(pelada.date)}</span>
        <AdminBadge />
      </div>
      <p className="px-4 pt-1 text-sm text-muted">Para dias atípicos, quando a escolha dos capitães não vale.</p>

      <SectionLabel>
        Quem vai jogar · {chosen.length} de {players.length}
      </SectionLabel>
      {list.length === 0 && <div className="px-4 text-sm text-muted">Ninguém confirmou presença ainda.</div>}
      {list.map((p) => (
        <label key={p.id} className="flex min-h-12 items-center gap-3 border-b border-row px-4">
          <input type="checkbox" className="h-5 w-5 accent-action" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
          <span className="flex-1">{p.name}</span>
          <span className="text-xs text-muted">overall {fmt(p.overall)}</span>
        </label>
      ))}
      {!showAll && (
        <button className="h-11 w-full text-sm font-semibold text-action" onClick={() => setShowAll(true)}>
          Ver todos os jogadores
        </button>
      )}

      <SectionLabel>Número de times</SectionLabel>
      <Segmented className="mx-4" value={n} onChange={setN} options={[['2', '2'], ['3', '3'], ['4', '4']]} />
      <label className="flex min-h-12 items-center gap-3 px-4 pt-2">
        <input type="checkbox" className="h-5 w-5 accent-action" checked={balance} onChange={(e) => setBalance(e.target.checked)} />
        Equilibrar pelo overall
      </label>
      <div className="px-4 pt-2">
        <button className="btn w-full" disabled={chosen.length < Number(n) * 2} onClick={() => setResult(draw(chosen, Number(n), balance))}>
          Sortear
        </button>
      </div>
    </div>
  )
}
