import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { Notice, Spinner } from '../components/ui'
import { useAuth } from '../lib/auth'
import { monthName, monthStart, todayISO } from '../lib/dates'
import { friendlyError } from '../lib/errors'
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

// mês (São Paulo) em que a nota foi alterada pela última vez
const monthOfTimestamp = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(ts)).slice(0, 7) + '-01'

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
  return <div className="p-6 text-center text-sm text-muted">As notas são dadas e recebidas só por mensalistas.</div>
}

// Lista dos colegas com a nota que você deu
export function AvaliarLista() {
  const { profile } = useAuth()
  const [players, setPlayers] = useState()
  const [mine, setMine] = useState({})

  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('id, name, photo_path').eq('status', 'ativo').eq('type', 'mensalista').neq('id', profile.id).order('name'),
      supabase.from('ratings').select('*').eq('rater_id', profile.id),
    ]).then(([p, r]) => {
      setPlayers(p.data ?? [])
      setMine(Object.fromEntries((r.data ?? []).map((x) => [x.rated_id, x])))
    })
  }, [profile.id])

  if (profile.type !== 'mensalista') return <NotMensalista />
  if (!players) return <Spinner />
  const thisMonth = monthStart(todayISO())
  const rated = players.filter((p) => mine[p.id]).length

  return (
    <div className="pb-6">
      <div className="card mx-4 mt-3 text-sm">
        <b>Você muda cada nota 1 vez por mês</b>
        <div className="mt-1 text-muted">
          É opcional: mude só quem quiser. A nota anterior continua valendo. Voto anônimo. Avaliados: {rated} de {players.length}.
        </div>
      </div>
      <div className="pt-2">
        {players.map((p) => {
          const r = mine[p.id]
          const incomplete = r && (r.defense == null || r.passing == null)
          const locked = r && !incomplete && monthOfTimestamp(r.updated_at) === thisMonth
          return (
            <Link key={p.id} to={`/notas/${p.id}`} className="flex min-h-16 items-center gap-3 border-b border-row px-4 active:bg-surface-2">
              <Avatar name={p.name} src={photoUrl(p.photo_path)} />
              <div className="min-w-0 flex-1">
                <div className="truncate">{p.name}</div>
                {r ? <MiniStars value={r.overall} /> : <span className="text-xs text-muted">ainda não avaliado</span>}
              </div>
              <span className={`text-sm font-semibold ${locked ? 'text-muted' : 'text-action'}`}>{incomplete ? 'Completar' : locked ? 'Mudou este mês' : r ? 'Alterar' : 'Avaliar'}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

// Votação de um jogador
export function Votar() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [player, setPlayer] = useState()
  const [current, setCurrent] = useState(null)
  const [values, setValues] = useState({ dribble: 0, shot: 0, speed: 0, defense: 0, passing: 0, overall: 0 })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('id, name, photo_path, type').eq('id', id).maybeSingle(),
      supabase.from('ratings').select('*').eq('rater_id', profile.id).eq('rated_id', id).maybeSingle(),
    ]).then(([p, r]) => {
      setPlayer(p.data)
      setCurrent(r.data)
      if (r.data) setValues(Object.fromEntries(RATING_FIELDS.map(([k]) => [k, r.data[k] ?? 0])))
    })
  }, [id, profile.id])

  if (profile.type !== 'mensalista') return <NotMensalista />
  if (player === undefined) return <Spinner />
  if (!player || player.type !== 'mensalista' || player.id === profile.id) {
    return <div className="p-6 text-center text-sm text-muted">Não dá para avaliar este jogador.</div>
  }

  const thisMonth = monthStart(todayISO())
  const incomplete = current && (current.defense == null || current.passing == null)
  const locked = current && !incomplete && monthOfTimestamp(current.updated_at) === thisMonth
  const complete = RATING_FIELDS.every(([k]) => values[k] > 0)

  async function save() {
    setBusy(true)
    setError('')
    const row = { rater_id: profile.id, rated_id: id, ...values }
    const { error } = current ? await supabase.from('ratings').update(values).eq('rater_id', profile.id).eq('rated_id', id) : await supabase.from('ratings').insert(row)
    setBusy(false)
    if (error) setError(friendlyError(error))
    else navigate('/notas')
  }

  return (
    <div className="pb-6">
      <div className="flex flex-col items-center px-4 pt-5">
        <Avatar name={player.name} src={photoUrl(player.photo_path)} size={72} />
        <b className="mt-2 text-lg">{player.name}</b>
        <div className="text-xs text-muted">
          {incomplete
            ? 'Faltam as notas de defesa e passe. Completar não conta como a mudança do mês.'
            : current
            ? locked
              ? `Você já mudou esta nota em ${monthName(thisMonth)}. Volte no mês que vem.`
              : `Sua nota atual (desde ${monthName(monthOfTimestamp(current.updated_at))}). Mude só se quiser.`
            : 'Opcional: avalie só se quiser.'}
        </div>
      </div>

      {RATING_FIELDS.map(([k, label]) => (
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

      <div className="space-y-2 px-4 pt-4">
        <Notice>{error}</Notice>
        {!locked && (
          <button className="btn w-full" disabled={!complete || busy} onClick={save}>
            {current ? 'Salvar alteração' : 'Salvar avaliação'}
          </button>
        )}
        <button className="h-11 w-full text-sm text-muted" onClick={() => navigate('/notas')}>
          {current ? 'Manter minha nota' : 'Voltar'}
        </button>
        <p className="text-xs text-muted">
          Voto anônimo. Você muda cada nota 1 vez por mês, só dos jogadores que quiser. A nota anterior continua valendo. Não dá para
          avaliar a si mesmo.
        </p>
      </div>
    </div>
  )
}
