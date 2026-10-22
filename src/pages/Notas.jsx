import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { PositionTags } from '../components/Positions'
import { Notice, Spinner } from '../components/ui'
import { useAuth } from '../lib/auth'
import { friendlyError } from '../lib/errors'
import { GK_RATING_FIELDS } from '../lib/positions'
import { photoUrl } from '../lib/storage'
import { supabase } from '../lib/supabase'

const RATING_FIELDS = [
  ['dribble', 'Drible'],
  ['shot', 'Chute'],
  ['speed', 'Velocidade'],
  ['defense', 'Defesa'],
  ['passing', 'Passe'],
  ['overall', 'Overall'],
]

// Notas de jogador (só mensalistas recebem) e de goleiro (quem o admin marcou como goleiro)
const KINDS = {
  linha: { table: 'ratings', fields: RATING_FIELDS, title: 'Como jogador' },
  gol: { table: 'goalkeeper_ratings', fields: GK_RATING_FIELDS, title: 'Como goleiro' },
}
const kindsOf = (p) => [...(p.type === 'mensalista' ? ['linha'] : []), ...(p.goalkeeper ? ['gol'] : [])]

// Cada nota muda 1 vez por pelada: trava se já mudou depois da última pelada encerrada
const isLocked = (rating, lastClosed) => Boolean(rating && lastClosed && Date.parse(rating.updated_at) >= Date.parse(lastClosed))
// nota antiga de jogador sem defesa e passe: completar não conta como mudança
const isIncomplete = (kind, rating) => kind === 'linha' && rating && (rating.defense == null || rating.passing == null)
const lastClosedAt = async () => {
  const { data } = await supabase.rpc('last_pelada_closed_at')
  return data === '-infinity' ? '1970-01-01T00:00:00Z' : data
}
const dayBR = (ts) => new Date(ts).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })

function MiniStars({ value }) {
  const pct = value ? (value / 5) * 100 : 0
  return (
    <span className="relative inline-block text-sm leading-none tracking-[2px] text-line">
      ★★★★★
      <i className="absolute top-0 left-0 overflow-hidden whitespace-nowrap text-silver not-italic" style={{ width: `${pct}%` }}>
        ★★★★★
      </i>
    </span>
  )
}

function NotMensalista() {
  return <div className="p-6 text-center text-sm text-muted">As notas são dadas só por mensalistas.</div>
}

// Lista dos colegas e goleiros com a nota que você deu
export function AvaliarLista() {
  const { profile } = useAuth()
  const [players, setPlayers] = useState()
  const [mine, setMine] = useState({ linha: {}, gol: {} })
  const [lastClosed, setLastClosed] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase
        .from('profiles')
        .select('id, name, photo_path, positions, type, goalkeeper')
        .eq('status', 'ativo')
        .or('type.eq.mensalista,goalkeeper.not.is.null')
        .neq('id', profile.id)
        .order('name'),
      supabase.from('ratings').select('*').eq('rater_id', profile.id),
      supabase.from('goalkeeper_ratings').select('*').eq('rater_id', profile.id),
      lastClosedAt(),
    ]).then(([p, r, g, closed]) => {
      setPlayers(p.data ?? [])
      const byRated = (rows) => Object.fromEntries((rows ?? []).map((x) => [x.rated_id, x]))
      setMine({ linha: byRated(r.data), gol: byRated(g.data) })
      setLastClosed(closed)
    })
  }, [profile.id])

  if (profile.type !== 'mensalista') return <NotMensalista />
  if (!players) return <Spinner />
  const rated = players.filter((p) => kindsOf(p).every((k) => mine[k][p.id])).length

  return (
    <div className="pb-6">
      <div className="card mx-4 mt-3 text-sm">
        <b>Você muda cada nota 1 vez por pelada</b>
        <div className="mt-1 text-muted">
          Quando o admin encerra a pelada, as notas liberam de novo. É opcional: mude só quem quiser. A nota anterior continua
          valendo. Voto anônimo. Avaliados: {rated} de {players.length}.
        </div>
      </div>
      <div className="pt-2">
        {players.map((p) => {
          const kinds = kindsOf(p)
          const given = kinds.map((k) => mine[k][p.id])
          const missing = given.some((r) => !r) || kinds.some((k) => isIncomplete(k, mine[k][p.id]))
          const locked = !missing && given.every((r) => isLocked(r, lastClosed))
          const stars = (mine.linha[p.id] ?? mine.gol[p.id])?.overall
          return (
            <Link key={p.id} to={`/notas/${p.id}`} className="flex min-h-16 items-center gap-3 border-b border-row px-4 active:bg-surface-2">
              <Avatar name={p.name} src={photoUrl(p.photo_path)} />
              <div className="min-w-0 flex-1">
                <div className="truncate">{p.name}</div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {stars ? <MiniStars value={stars} /> : <span className="text-xs text-muted">ainda não avaliado</span>}
                  <PositionTags positions={p.positions} goalkeeper={p.goalkeeper} />
                </div>
              </div>
              <span className={`text-sm font-semibold ${locked ? 'text-muted' : 'text-action'}`}>
                {missing ? (given.some(Boolean) ? 'Completar' : 'Avaliar') : locked ? 'Já mudou nesta rodada' : 'Alterar'}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

// Estrelas de um tipo de nota (jogador ou goleiro), com o próprio botão de salvar
function RatingForm({ kind, ratedId, current, lastClosed, showTitle, onSaved }) {
  const { profile } = useAuth()
  const { table, fields, title } = KINDS[kind]
  const [values, setValues] = useState(() => Object.fromEntries(fields.map(([k]) => [k, current?.[k] ?? 0])))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const incomplete = isIncomplete(kind, current)
  const locked = !incomplete && isLocked(current, lastClosed)
  const complete = fields.every(([k]) => values[k] > 0)

  async function save() {
    setBusy(true)
    setError('')
    const { error } = current
      ? await supabase.from(table).update(values).eq('rater_id', profile.id).eq('rated_id', ratedId)
      : await supabase.from(table).insert({ rater_id: profile.id, rated_id: ratedId, ...values })
    setBusy(false)
    if (error) setError(friendlyError(error))
    else onSaved()
  }

  return (
    <div className="pt-3">
      {showTitle && <div className="px-4 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">{title}</div>}
      <div className="px-4 text-xs text-muted">
        {incomplete
          ? 'Faltam as notas de defesa e passe. Completar não conta como a sua mudança.'
          : current
            ? locked
              ? 'Você já mudou esta nota nesta rodada. Libera de novo quando a próxima pelada for encerrada.'
              : `Sua nota atual (desde ${dayBR(current.updated_at)}). Mude só se quiser.`
            : 'Opcional: avalie só se quiser.'}
      </div>
      {fields.map(([k, label]) => (
        <div key={k} className="border-b border-row px-4 py-3">
          <div className="text-sm">{label}</div>
          <div className="mt-1 flex justify-between">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                disabled={locked}
                aria-label={`${label}: ${n} estrelas`}
                onClick={() => setValues((v) => ({ ...v, [k]: n }))}
                className={`h-12 w-14 text-[40px] leading-none ${n <= values[k] ? 'text-silver' : 'text-line'}`}
              >
                ★
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="space-y-2 px-4 pt-3">
        <Notice>{error}</Notice>
        {!locked && (
          <button className="btn w-full" disabled={!complete || busy} onClick={save}>
            {current ? 'Salvar alteração' : 'Salvar avaliação'}
            {showTitle && (kind === 'gol' ? ' de goleiro' : ' de jogador')}
          </button>
        )}
      </div>
    </div>
  )
}

// Votação de um jogador e/ou goleiro: quem é os dois mostra as duas listas, uma abaixo da outra
export function Votar() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [player, setPlayer] = useState()
  const [current, setCurrent] = useState({})
  const [lastClosed, setLastClosed] = useState(null)
  const [saved, setSaved] = useState('')

  const load = useCallback(
    () =>
      Promise.all([
        supabase.from('profiles').select('id, name, photo_path, type, goalkeeper').eq('id', id).maybeSingle(),
        supabase.from('ratings').select('*').eq('rater_id', profile.id).eq('rated_id', id).maybeSingle(),
        supabase.from('goalkeeper_ratings').select('*').eq('rater_id', profile.id).eq('rated_id', id).maybeSingle(),
        lastClosedAt(),
      ]).then(([p, r, g, closed]) => {
        setLastClosed(closed)
        setPlayer(p.data)
        setCurrent({ linha: r.data, gol: g.data })
      }),
    [id, profile.id],
  )

  useEffect(() => {
    load()
  }, [load])

  if (profile.type !== 'mensalista') return <NotMensalista />
  if (player === undefined) return <Spinner />
  const kinds = player ? kindsOf(player) : []
  if (!player || !kinds.length || player.id === profile.id) {
    return <div className="p-6 text-center text-sm text-muted">Não dá para avaliar este jogador.</div>
  }

  // com as duas listas, salvar uma não sai da tela
  function onSaved(kind) {
    if (kinds.length === 1) return navigate('/notas')
    setSaved(kind === 'gol' ? 'Nota de goleiro salva.' : 'Nota de jogador salva.')
    load()
  }

  return (
    <div className="pb-6">
      <div className="flex flex-col items-center px-4 pt-5">
        <Avatar name={player.name} src={photoUrl(player.photo_path)} size={72} />
        <b className="mt-2 text-lg">{player.name}</b>
      </div>

      {kinds.map((k) => (
        <RatingForm key={k} kind={k} ratedId={id} current={current[k]} lastClosed={lastClosed} showTitle={kinds.length > 1} onSaved={() => onSaved(k)} />
      ))}

      <div className="space-y-2 px-4 pt-3">
        <Notice kind="ok">{saved}</Notice>
        <button className="h-11 w-full text-sm text-muted" onClick={() => navigate('/notas')}>
          {kinds.some((k) => current[k]) ? 'Manter minha nota' : 'Voltar'}
        </button>
        <p className="text-xs text-muted">
          Voto anônimo. Você muda cada nota 1 vez por pelada, só dos jogadores que quiser. A nota anterior continua valendo. Não dá para
          avaliar a si mesmo.
        </p>
      </div>
    </div>
  )
}
