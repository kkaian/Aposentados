import { CalendarX2, ChevronLeft, ChevronRight, Star } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { PushCard } from '../components/PushControls'
import { Notice, Segmented, Spinner } from '../components/ui'
import { useAuth } from '../lib/auth'
import { addMonths, dayLabel, monthName, monthStart, timeLabel, todayISO } from '../lib/dates'
import { friendlyError } from '../lib/errors'
import { photoUrl } from '../lib/storage'
import { supabase } from '../lib/supabase'

const TABS = [
  ['total', 'Total'],
  ['wins', 'Vitórias'],
  ['goals', 'Gols'],
  ['assists', 'Assist.'],
]

const RANK_FIELD = { total: 'rank_total', wins: 'rank_wins', goals: 'rank_goals', assists: 'rank_assists' }

function NextPelada() {
  const { profile } = useAuth()
  const [pelada, setPelada] = useState()
  const [going, setGoing] = useState(0)
  const [mine, setMine] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('peladas')
      .select('*')
      .gte('date', todayISO())
      .in('status', ['agendada', 'em_andamento'])
      .order('date')
      .limit(1)
      .maybeSingle()
    setPelada(data)
    if (!data) return
    const { data: list } = await supabase.from('presence_list').select('profile_id, answer, waitlisted').eq('pelada_id', data.id)
    setGoing((list ?? []).filter((p) => p.answer === 'vou' && !p.waitlisted).length)
    setMine(list?.find((p) => p.profile_id === profile.id) ?? null)
  }, [profile.id])

  useEffect(() => {
    load()
  }, [load])

  async function answer(value) {
    if (mine?.answer === value) return
    setBusy(true)
    setError('')
    const { error } = await supabase
      .from('presence')
      .upsert({ pelada_id: pelada.id, profile_id: profile.id, answer: value, answered_at: new Date().toISOString() })
    setBusy(false)
    if (error) setError(/row-level/.test(error.message) ? 'A presença é para mensalistas e diaristas chamados pelo admin.' : friendlyError(error))
    else load()
  }

  if (pelada === undefined) return null
  if (!pelada) {
    return (
      <div className="card mx-4 mt-3 text-sm text-muted">
        <div className="text-xs font-semibold tracking-wide">PRÓXIMA PELADA</div>
        Nenhuma pelada marcada ainda.
      </div>
    )
  }

  const status = mine?.waitlisted ? 'Você está na lista de espera' : mine?.answer === 'vou' ? 'Você vai' : mine ? 'Você não vai' : null

  return (
    <div className="card mx-4 mt-3">
      <div className="flex items-center gap-2">
        <Link to="/presenca" className="flex-1">
          <div className="text-xs font-semibold tracking-wide text-muted">PRÓXIMA PELADA</div>
          <div className="font-bold">
            {dayLabel(pelada.date)} · {timeLabel(pelada.start_time)}
          </div>
          <div className="text-xs text-muted">
            {going} de {pelada.max_slots} vagas · {pelada.location}
          </div>
        </Link>
        <button
          className={`h-11 w-[72px] rounded-lg border-2 border-action font-semibold ${mine?.answer === 'vou' ? 'bg-action text-white' : 'text-action'}`}
          disabled={busy || !pelada.presence_open}
          onClick={() => answer('vou')}
        >
          Vou
        </button>
        <button
          className={`h-11 w-[88px] rounded-lg border-2 font-semibold ${mine?.answer === 'nao_vou' ? 'border-line-2 bg-surface-2 text-ink' : 'border-line-2 text-muted'}`}
          disabled={busy || !pelada.presence_open}
          onClick={() => answer('nao_vou')}
        >
          Não vou
        </button>
      </div>
      {status && <div className="mt-2 text-xs text-muted">{status}</div>}
      {error && (
        <div className="mt-2">
          <Notice>{error}</Notice>
        </div>
      )}
    </div>
  )
}

function statLine(r) {
  return `${r.goals}G · ${r.assists}A · ${r.wins}V`
}

function PodiumCard({ row, metric, first }) {
  return (
    <Link
      to={`/jogador/${row.profile_id}`}
      className={`flex flex-1 flex-col items-center rounded-xl border px-1 text-center ${
        first ? 'border-silver bg-surface-2 py-5' : 'border-line bg-surface py-3'
      }`}
    >
      {first && <Star size={18} className="mb-1 fill-gold text-gold" />}
      <span
        className={`mb-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 text-sm font-bold ${
          row._rank === 1
            ? 'border-gold bg-gold text-bg'
            : row._rank === 2
              ? 'border-medal-silver text-medal-silver'
              : 'border-bronze text-bronze'
        }`}
      >
        {row._rank}
      </span>
      <Avatar name={row.name} src={photoUrl(row.photo_path)} size={first ? 64 : 48} />
      <span className="mt-1.5 line-clamp-1 text-sm">{row.name}</span>
      <b className="text-2xl">{row[metric]}</b>
      <small className="text-[11px] text-muted">{statLine(row)}</small>
    </Link>
  )
}

export default function Inicio() {
  const [month, setMonth] = useState(monthStart(todayISO()))
  const [tab, setTab] = useState('total')
  const [rows, setRows] = useState()
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setRows(undefined)
    supabase
      .from('podium')
      .select('*')
      .eq('month', month)
      .then(({ data, error }) => {
        if (!alive) return
        if (error) setError(friendlyError(error))
        setRows(data ?? [])
      })
    return () => {
      alive = false
    }
  }, [month])

  const rankField = RANK_FIELD[tab]
  const ranked = (rows ?? [])
    .map((r) => ({ ...r, _rank: r[rankField] }))
    .sort((a, b) => a._rank - b._rank || a.name.localeCompare(b.name))
  const tied = (r) => ranked.filter((x) => x._rank === r._rank).length > 1
  // pódio: 2º à esquerda, 1º no meio, 3º à direita (com empate, segue a ordem do ranking)
  const top = ranked.slice(0, 3)
  const podiumOrder = top.length === 3 ? [top[1], top[0], top[2]] : top

  return (
    <div className="pb-4">
      <NextPelada />
      <PushCard />

      <div className="flex items-center pt-4 pr-2 pl-4">
        <span className="flex-1 text-lg font-bold">
          Pódio de {monthName(month)}
          {month.slice(0, 4) !== todayISO().slice(0, 4) && ` ${month.slice(0, 4)}`}
        </span>
        <button className="flex h-11 w-11 items-center justify-center" aria-label="Mês anterior" onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft size={22} />
        </button>
        <button
          className="flex h-11 w-11 items-center justify-center disabled:opacity-30"
          aria-label="Próximo mês"
          disabled={month >= monthStart(todayISO())}
          onClick={() => setMonth(addMonths(month, 1))}
        >
          <ChevronRight size={22} />
        </button>
      </div>

      {rows === undefined ? (
        <Spinner />
      ) : error ? (
        <div className="p-4">
          <Notice>{error}</Notice>
        </div>
      ) : ranked.length === 0 ? (
        <div className="flex flex-col items-center px-8 pt-12 text-center">
          <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-surface text-muted">
            <CalendarX2 size={30} />
          </span>
          <b className="text-lg">Ainda não houve pelada em {monthName(month)}</b>
          <p className="mt-1 text-sm text-muted">O pódio aparece depois da primeira pelada encerrada no mês.</p>
          <button className="btn-outline mt-6" onClick={() => setMonth(addMonths(month, -1))}>
            Ver mês anterior
          </button>
        </div>
      ) : (
        <>
          <Segmented options={TABS} value={tab} onChange={setTab} className="mx-4 mt-1 mb-4" />
          <div className="flex items-end gap-2 px-4">
            {podiumOrder.map((r) => (
              <PodiumCard key={r.profile_id} row={r} metric={tab} first={r === top[0]} />
            ))}
          </div>
          <div className="px-4 pt-3">
            {ranked.slice(3).map((r) => (
              <Link key={r.profile_id} to={`/jogador/${r.profile_id}`} className="flex min-h-14 items-center gap-3 border-b border-row">
                <b className="w-6 text-center text-muted">{r._rank}</b>
                <Avatar name={r.name} src={photoUrl(r.photo_path)} />
                <div className="flex-1">
                  <div>{r.name}</div>
                  <small className="text-[11px] text-muted">
                    {tied(r) && 'empate · '}
                    {statLine(r)}
                  </small>
                </div>
                <b>{r[tab]}</b>
              </Link>
            ))}
          </div>
          <div className="card mx-4 mt-4 text-xs text-muted">
            Total = gols + assistências. Empate: quem tem mais vitórias fica na frente. Empatou em tudo, os jogadores dividem a
            posição e a seguinte é pulada. Só mensalistas entram no pódio.
          </div>
        </>
      )}
    </div>
  )
}
