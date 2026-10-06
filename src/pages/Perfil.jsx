import { Camera, ChevronLeft, ChevronRight, Trophy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { Notice, Segmented, Spinner } from '../components/ui'
import { useAuth } from '../lib/auth'
import { addMonths, monthLabel, monthStart, todayISO } from '../lib/dates'
import { friendlyError } from '../lib/errors'
import { photoUrl, uploadAvatar } from '../lib/storage'
import { supabase } from '../lib/supabase'

const ROLE_LABEL = { dono: 'Dono', admin: 'Admin', jogador: null }
const TYPE_LABEL = { mensalista: 'Mensalista', diarista: 'Diarista' }

const RATING_ROWS = [
  ['dribble', 'Drible'],
  ['shot', 'Chute'],
  ['speed', 'Velocidade'],
  ['overall', 'Overall'],
]

function Stars({ value }) {
  const pct = value ? (value / 5) * 100 : 0
  return (
    <span className="relative inline-block text-[22px] leading-none tracking-[3px] text-line">
      ★★★★★
      <i className="absolute top-0 left-0 overflow-hidden whitespace-nowrap text-silver not-italic" style={{ width: `${pct}%` }}>
        ★★★★★
      </i>
    </span>
  )
}

function StatsBlock({ profileId }) {
  const [period, setPeriod] = useState('mes')
  const [month, setMonth] = useState(monthStart(todayISO()))
  const [rows, setRows] = useState()

  useEffect(() => {
    let alive = true
    supabase
      .from('player_month_stats')
      .select('*')
      .eq('profile_id', profileId)
      .then(({ data }) => alive && setRows(data ?? []))
    return () => {
      alive = false
    }
  }, [profileId])

  const year = month.slice(0, 4)
  const filtered = (rows ?? []).filter((r) => (period === 'mes' ? r.month === month : period === 'ano' ? r.month.startsWith(year) : true))
  const sum = (k) => filtered.reduce((n, r) => n + r[k], 0)
  const step = period === 'ano' ? 12 : 1
  const label = period === 'mes' ? monthLabel(month) : period === 'ano' ? year : 'Desde o início'

  return (
    <>
      <Segmented
        options={[
          ['mes', 'Mês'],
          ['ano', 'Ano'],
          ['geral', 'Geral'],
        ]}
        value={period}
        onChange={setPeriod}
        className="mx-4"
      />
      <div className="flex items-center justify-between px-2 pt-1">
        <button
          className="flex h-11 w-11 items-center justify-center disabled:invisible"
          aria-label="Anterior"
          disabled={period === 'geral'}
          onClick={() => setMonth(addMonths(month, -step))}
        >
          <ChevronLeft size={22} />
        </button>
        <span className="font-semibold">{label}</span>
        <button
          className="flex h-11 w-11 items-center justify-center disabled:invisible"
          aria-label="Próximo"
          disabled={period === 'geral' || addMonths(month, step) > monthStart(todayISO())}
          onClick={() => setMonth(addMonths(month, step))}
        >
          <ChevronRight size={22} />
        </button>
      </div>
      <div className="flex gap-2 px-4">
        {[
          ['goals', 'Gols'],
          ['assists', 'Assist.'],
          ['wins', 'Vitórias'],
        ].map(([k, l]) => (
          <div key={k} className="flex-1 rounded-lg border border-line py-3 text-center">
            <b className="block text-2xl">{rows === undefined ? '–' : sum(k)}</b>
            <span className="text-xs text-muted">{l}</span>
          </div>
        ))}
      </div>
    </>
  )
}

function RatingsBlock({ profileId }) {
  const [summary, setSummary] = useState()
  useEffect(() => {
    supabase
      .from('rating_summary')
      .select('*')
      .eq('profile_id', profileId)
      .maybeSingle()
      .then(({ data }) => setSummary(data ?? { votes: 0 }))
  }, [profileId])

  const enough = summary?.overall != null
  return (
    <div className="card mx-4 mt-4">
      <div className="mb-1 flex items-baseline justify-between">
        <b>Notas</b>
        <span className="text-xs text-muted">média das avaliações</span>
      </div>
      {RATING_ROWS.map(([k, l]) => (
        <div key={k} className="flex h-10 items-center gap-3 text-sm">
          <span className="w-24">{l}</span>
          <Stars value={enough ? Number(summary[k]) : 0} />
          <span className="ml-auto text-muted">{enough ? Number(summary[k]).toFixed(1).replace('.', ',') : '–'}</span>
        </div>
      ))}
      {summary && !enough && (
        <div className="mt-1 text-xs text-muted">
          A média aparece com 3 ou mais avaliações ({summary.votes} até agora).
        </div>
      )}
    </div>
  )
}

export default function Perfil() {
  const { id } = useParams()
  const { profile: me, refreshProfile } = useAuth()
  const isMe = !id || id === me.id
  const [player, setPlayer] = useState(isMe ? me : undefined)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    if (isMe) {
      setPlayer(me)
      return
    }
    supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => setPlayer(data))
  }, [id, isMe, me])

  async function changePhoto(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    setUploading(true)
    try {
      const path = await uploadAvatar(me.id, file)
      const { error } = await supabase.from('profiles').update({ photo_path: path }).eq('id', me.id)
      if (error) throw error
      await refreshProfile()
    } catch (err) {
      setError(friendlyError(err))
    }
    setUploading(false)
  }

  if (player === undefined) return <Spinner />
  if (!player) return <div className="p-6 text-center text-muted">Jogador não encontrado.</div>

  const role = ROLE_LABEL[player.role]

  return (
    <div className="pb-6">
      <div className="flex flex-col items-center px-4 pt-6 pb-4">
        <div className="relative">
          <Avatar name={player.name} src={photoUrl(player.photo_path)} size={96} />
          {isMe && (
            <button
              className="absolute -right-1 -bottom-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-bg bg-action text-white"
              aria-label="Trocar foto"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              <Camera size={18} />
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={changePhoto} />
        </div>
        <b className="mt-3 text-xl">{player.name}</b>
        <div className="mt-1 flex gap-2 text-xs">
          <span className="rounded-md bg-surface-2 px-2 py-0.5 text-silver">{TYPE_LABEL[player.type]}</span>
          {role && <span className="rounded-md border border-line-2 px-2 py-0.5 text-muted">{role}</span>}
          {player.username && <span className="py-0.5 text-muted">@{player.username}</span>}
        </div>
        {uploading && <div className="mt-2 text-xs text-muted">Enviando foto…</div>}
        {error && (
          <div className="mt-3 w-full">
            <Notice>{error}</Notice>
          </div>
        )}
      </div>

      <StatsBlock profileId={player.id} />
      <RatingsBlock profileId={player.id} />

      <div className="card mx-4 mt-4">
        <div className="mb-2 flex items-baseline justify-between">
          <b>Troféus</b>
          <span className="text-xs text-muted">prêmios mensais</span>
        </div>
        <div className="flex items-center gap-3 py-2 text-sm text-muted">
          <Trophy size={20} />
          Sem troféus ainda
        </div>
      </div>

      <div className="px-4 pt-4">
        {isMe ? (
          <Link to="/notas" className="btn-outline flex w-full items-center justify-center">
            Avaliar colegas
          </Link>
        ) : (
          player.type === 'mensalista' &&
          me.type === 'mensalista' && (
            <Link to={`/notas/${player.id}`} className="btn-outline flex w-full items-center justify-center">
              Avaliar este jogador
            </Link>
          )
        )}
      </div>
    </div>
  )
}
