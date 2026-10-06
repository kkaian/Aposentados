import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Spinner } from '../components/ui'
import { addMonths, dayLabel, monthLabel, monthStart, todayISO } from '../lib/dates'
import { daySummary, makeNamer, scoreOf } from '../lib/games'
import { supabase } from '../lib/supabase'
import { fetchTeams } from '../lib/teams'

export default function Historico() {
  const [month, setMonth] = useState(monthStart(todayISO()))
  const [playerId, setPlayerId] = useState('')
  const [players, setPlayers] = useState([])
  const [items, setItems] = useState()

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, name')
      .eq('status', 'ativo')
      .order('name')
      .then(({ data }) => setPlayers(data ?? []))
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      setItems(undefined)
      const { data: peladas } = await supabase
        .from('peladas')
        .select('*')
        .gte('date', month)
        .lt('date', addMonths(month, 1))
        .in('status', ['em_andamento', 'encerrada'])
        .order('date', { ascending: false })
      const list = peladas ?? []
      const ids = list.map((p) => p.id)
      const [{ data: games }, { data: guests }, { data: profiles }, { data: lineup }] = await Promise.all([
        ids.length ? supabase.from('games').select('*').in('pelada_id', ids).order('number') : { data: [] },
        ids.length ? supabase.from('guests').select('id, name').in('pelada_id', ids) : { data: [] },
        supabase.from('profiles').select('id, name'),
        playerId && ids.length ? supabase.from('game_lineup').select('game_id').eq('profile_id', playerId) : { data: null },
      ])
      const gameIds = (games ?? []).map((g) => g.id)
      const { data: events } = gameIds.length ? await supabase.from('game_events').select('*').in('game_id', gameIds) : { data: [] }
      const name = makeNamer(profiles ?? [], guests ?? [])
      const played = lineup ? new Set(lineup.map((l) => l.game_id)) : null

      const result = []
      for (const p of list) {
        const teams = await fetchTeams(p.id)
        const pg = (games ?? []).filter((g) => g.pelada_id === p.id && (!played || played.has(g.id)))
        if (played && pg.length === 0) continue
        result.push({ pelada: p, teams, games: pg, events: events ?? [], summary: daySummary(pg, events ?? [], teams, name) })
      }
      if (alive) setItems(result)
    })()
    return () => {
      alive = false
    }
  }, [month, playerId])

  return (
    <div className="pb-6">
      <div className="flex items-center px-2 pt-2">
        <button className="flex h-11 w-11 items-center justify-center" aria-label="Mês anterior" onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft size={22} />
        </button>
        <b className="flex-1 text-center">{monthLabel(month)}</b>
        <button
          className="flex h-11 w-11 items-center justify-center disabled:opacity-30"
          aria-label="Próximo mês"
          disabled={month >= monthStart(todayISO())}
          onClick={() => setMonth(addMonths(month, 1))}
        >
          <ChevronRight size={22} />
        </button>
      </div>
      <div className="px-4 pb-2">
        <select className="field" value={playerId} onChange={(e) => setPlayerId(e.target.value)} aria-label="Filtrar jogador">
          <option value="">Todos os jogadores</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {items === undefined && <Spinner />}
      {items?.length === 0 && <div className="px-4 py-6 text-center text-sm text-muted">Nenhuma pelada neste mês.</div>}
      {items?.map(({ pelada, teams, games, events, summary }) => {
        const label = Object.fromEntries(teams.map((t) => [t.id, t.label]))
        return (
          <div key={pelada.id} className="card mx-4 mt-3">
            <div className="flex items-baseline justify-between">
              <b>{dayLabel(pelada.date)}</b>
              <span className="text-xs text-muted">{pelada.location}</span>
            </div>
            <div className="text-xs text-muted">
              {summary.games} jogos · {summary.goals} gols
              {summary.champions.length > 0 && ` · Campeão: ${summary.champions.map((t) => t.label).join(', ')}`}
            </div>
            {(summary.scorer || summary.assister) && (
              <div className="mt-1 text-xs text-muted">
                {summary.scorer && `Artilheiro: ${summary.scorer.names.join(', ')}`}
                {summary.scorer && summary.assister && ' · '}
                {summary.assister && `Garçom: ${summary.assister.names.join(', ')}`}
              </div>
            )}
            <div className="mt-2 divide-y divide-row border-t border-row">
              {games.map((g) => {
                const [a, b] = scoreOf(g, events)
                return (
                  <Link key={g.id} to={`/jogo/${g.id}`} className="flex min-h-11 items-center gap-2 text-sm">
                    <span className="w-14 text-xs text-muted">Jogo {g.number}</span>
                    <span className="flex-1 truncate">
                      {label[g.team1_id]} <b>{a} x {b}</b> {label[g.team2_id]}
                    </span>
                    <span className="text-xs font-semibold text-action">Ver eventos</span>
                  </Link>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
