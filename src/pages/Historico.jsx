import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Spinner } from '../components/ui'
import { AWARDS, groupAwards } from '../lib/awards'
import { addMonths, dayLabel, lastSunday, monthClosed, monthLabel, monthName, monthStart, todayISO } from '../lib/dates'
import { daySummary, makeNamer, scoreOf, wonOnPenalties } from '../lib/games'
import { supabase } from '../lib/supabase'
import { fetchTeams } from '../lib/teams'

// Vitórias, gols e assistências de um jogador (numa pelada ou no mês)
function PlayerLine({ title, stats }) {
  return (
    <div className="rounded-lg border border-line-2 bg-surface-2 px-3 py-2">
      <div className="truncate text-xs text-muted">{title}</div>
      <div className="mt-0.5 grid grid-cols-3 text-center">
        {[
          ['Vitórias', stats?.wins],
          ['Gols', stats?.goals],
          ['Assistências', stats?.assists],
        ].map(([label, value]) => (
          <div key={label}>
            <b className="text-lg">{value ?? 0}</b>
            <div className="text-[11px] text-muted">{label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Mês fechado: números do mês, premiados e ranking
function MonthCard({ month, data, name }) {
  return (
    <div className="card mx-4 mt-1">
      <b>{monthName(month)[0].toUpperCase() + monthName(month).slice(1)} fechado</b>
      <div className="text-xs text-muted">
        {data.peladas} {data.peladas === 1 ? 'pelada' : 'peladas'} · {data.games} jogos · {data.goals} gols
      </div>
      {data.awards.length > 0 && (
        <div className="mt-2 border-t border-row">
          {groupAwards(data.awards).map((g) => {
            const def = AWARDS[g.award]
            return (
              <div key={`${g.award}-${g.position}`} className="flex min-h-11 items-center gap-3 border-b border-row py-1 last:border-0">
                <span className="w-7 text-center text-xl">{def.icon[Math.min(g.position, def.icon.length) - 1]}</span>
                <div className="min-w-0">
                  <div className="text-xs text-muted">{def.label(g.position)}</div>
                  <div className="text-sm">{g.ids.map((id) => name(id)).join(', ')}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {data.ranking.length > 0 && (
        <details className="mt-2 border-t border-row pt-2">
          <summary className="cursor-pointer text-sm font-semibold text-action">Ranking do mês</summary>
          <div className="mt-2 flex text-[11px] text-muted">
            <span className="flex-1">Jogador</span>
            <span className="w-8 text-center">J</span>
            <span className="w-8 text-center">V</span>
            <span className="w-8 text-center">G</span>
            <span className="w-8 text-center">A</span>
          </div>
          {data.ranking.map((r) => (
            <div key={r.profile_id} className="flex min-h-9 items-center border-b border-row text-sm last:border-0">
              <span className="w-6 text-xs text-muted">{r.rank_total}º</span>
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <span className="w-8 text-center">{r.games}</span>
              <span className="w-8 text-center">{r.wins}</span>
              <span className="w-8 text-center">{r.goals}</span>
              <span className="w-8 text-center">{r.assists}</span>
            </div>
          ))}
        </details>
      )}
      <p className="mt-2 text-xs text-muted">
        {data.pending ? 'Tem pelada sem encerrar: os números ainda vão mudar.' : 'Se houver outra pelada neste mês, os números e os premiados atualizam.'}
      </p>
    </div>
  )
}

export default function Historico() {
  const [month, setMonth] = useState(monthStart(todayISO()))
  const [playerId, setPlayerId] = useState('')
  const [players, setPlayers] = useState([])
  const [items, setItems] = useState()
  const [monthData, setMonthData] = useState(null)
  const [playerMonth, setPlayerMonth] = useState(null)

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
      const closed = monthClosed(month)
      const [{ data: games }, { data: guests }, { data: profiles }, { data: lineup }, { data: playerStats }, { data: playerTotal }, { data: awards }, { data: ranking }] = await Promise.all([
        ids.length ? supabase.from('games').select('*').in('pelada_id', ids).order('number') : { data: [] },
        ids.length ? supabase.from('guests').select('id, name').in('pelada_id', ids) : { data: [] },
        supabase.from('profiles').select('id, name'),
        playerId && ids.length ? supabase.from('game_lineup').select('game_id').eq('profile_id', playerId) : { data: null },
        playerId && ids.length ? supabase.from('player_pelada_stats').select('*').eq('profile_id', playerId).in('pelada_id', ids) : { data: [] },
        playerId ? supabase.from('player_month_stats').select('*').eq('profile_id', playerId).eq('month', month).maybeSingle() : { data: null },
        closed ? supabase.from('awards').select('*').eq('month', month) : { data: [] },
        closed ? supabase.from('podium').select('*').eq('month', month).order('rank_total').order('name') : { data: [] },
      ])
      const gameIds = (games ?? []).map((g) => g.id)
      const { data: events } = gameIds.length ? await supabase.from('game_events').select('*').in('game_id', gameIds) : { data: [] }
      const name = makeNamer(profiles ?? [], guests ?? [])
      const played = lineup ? new Set(lineup.map((l) => l.game_id)) : null
      const statsOf = Object.fromEntries((playerStats ?? []).map((s) => [s.pelada_id, s]))

      const result = []
      for (const p of list) {
        const teams = await fetchTeams(p.id)
        const pg = (games ?? []).filter((g) => g.pelada_id === p.id && (!played || played.has(g.id)))
        if (played && pg.length === 0) continue
        result.push({ pelada: p, teams, games: pg, events: events ?? [], summary: daySummary(pg, events ?? [], teams, name), playerStats: statsOf[p.id] })
      }

      // os números do mês não dependem do filtro de jogador e só somam pelada encerrada, como o pódio
      const closedIds = new Set(list.filter((p) => p.status === 'encerrada').map((p) => p.id))
      const closedGames = (games ?? []).filter((g) => closedIds.has(g.pelada_id))
      const summary = daySummary(closedGames, events ?? [], [], name)
      if (alive) {
        setItems(result)
        setPlayerMonth(playerId ? (playerTotal ?? {}) : null)
        setMonthData(
          closed && closedIds.size
            ? {
                peladas: closedIds.size,
                games: summary.games,
                goals: summary.goals,
                awards: awards ?? [],
                ranking: ranking ?? [],
                pending: list.some((p) => p.status === 'em_andamento'),
                name: (id) => name(id, null),
              }
            : null,
        )
      }
    })()
    return () => {
      alive = false
    }
  }, [month, playerId])

  const playerName = players.find((p) => p.id === playerId)?.name ?? 'Jogador'

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
      {items && monthData && <MonthCard month={month} data={monthData} name={monthData.name} />}
      {items && !monthClosed(month) && (
        <p className="px-4 pb-1 text-xs text-muted">
          Este mês fecha depois do domingo {lastSunday(month).slice(8)}/{lastSunday(month).slice(5, 7)}: aí aparecem os dados do mês e os premiados.
        </p>
      )}
      {items && playerMonth && (
        <div className="mx-4 mt-3">
          <PlayerLine title={`${playerName} em ${monthName(month)} (peladas encerradas)`} stats={playerMonth} />
        </div>
      )}
      {items?.length === 0 && <div className="px-4 py-6 text-center text-sm text-muted">{playerId ? 'Este jogador não jogou neste mês.' : 'Nenhuma pelada neste mês.'}</div>}
      {items?.map(({ pelada, teams, games, events, summary, playerStats }) => {
        const label = Object.fromEntries(teams.map((t) => [t.id, t.label]))
        return (
          <div key={pelada.id} className="card mx-4 mt-3">
            {playerId && (
              <div className="mb-2">
                <PlayerLine title={`${playerName} nesta pelada`} stats={playerStats} />
              </div>
            )}
            <div className="flex items-baseline justify-between gap-2">
              <b>{dayLabel(pelada.date)}</b>
              <span className="min-w-0 flex-1 truncate text-xs text-muted">{pelada.location}</span>
              <Link to={`/pelada/${pelada.id}`} className="text-xs font-semibold text-action">
                Abrir pelada
              </Link>
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
                      {wonOnPenalties(g, events) && <span className="text-xs text-muted"> · pên.: {label[g.penalty_winner_id]}</span>}
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
