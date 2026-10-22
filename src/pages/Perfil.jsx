import { Camera, ChevronLeft, ChevronRight, Pencil, Trophy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { PositionTags, PositionsSheet } from '../components/Positions'
import { GK_RATING_FIELDS } from '../lib/positions'
import { PushSetting } from '../components/PushControls'
import { Notice, Segmented, Spinner } from '../components/ui'
import { useAuth } from '../lib/auth'
import { addMonths, monthLabel, monthName, monthStart, todayISO } from '../lib/dates'
import { friendlyError } from '../lib/errors'
import { photoUrl, uploadAvatar } from '../lib/storage'
import { supabase } from '../lib/supabase'

const ROLE_LABEL = { dono: 'Dono', admin: 'Admin', jogador: null }
const TYPE_LABEL = { mensalista: 'Mensalista', diarista: 'Diarista' }

const RATING_ROWS = [
  ['dribble', 'Drible'],
  ['shot', 'Chute'],
  ['speed', 'Velocidade'],
  ['defense', 'Defesa'],
  ['passing', 'Passe'],
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

const PLAYER_STATS = [
  ['goals', 'Gols'],
  ['assists', 'Assist.'],
  ['wins', 'Vitórias'],
]

// Goleiro: no lugar dos gols, gols sofridos e defesas difíceis. Quem também joga na linha vê "Assist.*"
const keeperStats = (both) => [
  ['wins', 'Vitórias'],
  ['conceded', 'Gols sofridos'],
  ['assists', both ? 'Assist.*' : 'Assist.'],
  ['saves', 'Defesas difíceis'],
]

function StatsBlock({ profileId, view = 'player_month_stats', fields = PLAYER_STATS }) {
  const [period, setPeriod] = useState('mes')
  const [month, setMonth] = useState(monthStart(todayISO()))
  const [rows, setRows] = useState()

  useEffect(() => {
    let alive = true
    supabase
      .from(view)
      .select('*')
      .eq('profile_id', profileId)
      .then(({ data }) => alive && setRows(data ?? []))
    return () => {
      alive = false
    }
  }, [profileId, view])

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
        {fields.map(([k, l]) => (
          <div key={k} className="min-w-0 flex-1 rounded-lg border border-line py-3 text-center">
            <b className="block text-2xl">{rows === undefined ? '–' : sum(k)}</b>
            <span className="text-xs leading-tight text-muted">{l}</span>
          </div>
        ))}
      </div>
    </>
  )
}

function RatingsBlock({ profileId, view = 'rating_summary', rows = RATING_ROWS, title = 'Notas' }) {
  const [summary, setSummary] = useState()
  useEffect(() => {
    supabase
      .from(view)
      .select('*')
      .eq('profile_id', profileId)
      .maybeSingle()
      .then(({ data }) => setSummary(data ?? { votes: 0 }))
  }, [profileId, view])

  const enough = summary?.overall != null
  return (
    <div className="card mx-4 mt-4">
      <div className="mb-1 flex items-baseline justify-between">
        <b>{title}</b>
        <span className="text-xs text-muted">média das avaliações</span>
      </div>
      {rows.map(([k, l]) => (
        <div key={k} className="flex h-10 items-center gap-3 text-sm">
          <span className="w-24 leading-tight">{l}</span>
          <Stars value={enough && summary[k] != null ? Number(summary[k]) : 0} />
          <span className="ml-auto text-muted">{enough && summary[k] != null ? Number(summary[k]).toFixed(1).replace('.', ',') : '–'}</span>
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

const AWARDS = {
  melhor_mes: { icon: ['🏆', '🥈', '🥉'], label: (pos) => `Melhor do mês · ${pos}º lugar` },
  artilheiro: { icon: ['⚽'], label: () => 'Artilheiro do mês' },
  garcom: { icon: ['🎯'], label: () => 'Garçom do mês' },
  mais_vitorias: { icon: ['💪'], label: () => 'Mais vitórias do mês' },
  selecao: { icon: ['⭐'], label: () => 'Seleção do mês' },
}

function TrophiesBlock({ profileId }) {
  const [awards, setAwards] = useState()
  useEffect(() => {
    supabase
      .from('awards')
      .select('*')
      .eq('profile_id', profileId)
      .order('month', { ascending: false })
      .then(({ data }) => setAwards(data ?? []))
  }, [profileId])

  return (
    <div className="card mx-4 mt-4">
      <div className="mb-1 flex items-baseline justify-between">
        <b>Troféus</b>
        <span className="text-xs text-muted">prêmios mensais</span>
      </div>
      {awards?.length === 0 && (
        <div className="flex items-center gap-3 py-2 text-sm text-muted">
          <Trophy size={20} />
          Sem troféus ainda
        </div>
      )}
      {awards?.map((a) => {
        const def = AWARDS[a.award]
        return (
          <div key={`${a.month}-${a.award}`} className="flex min-h-12 items-center gap-3 border-b border-row last:border-0">
            <span className="w-7 text-center text-xl">{def.icon[Math.min(a.position, def.icon.length) - 1]}</span>
            <div>
              <div className="text-sm">{def.label(a.position)}</div>
              <div className="text-xs text-muted">
                {monthName(a.month)} {a.month.slice(0, 4)}
              </div>
            </div>
          </div>
        )
      })}
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
  const [editPositions, setEditPositions] = useState(false)
  // quem é jogador e goleiro alterna os números e as notas pela seta
  const [asKeeper, setAsKeeper] = useState(false)
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

  async function savePositions(positions) {
    const { error } = await supabase.from('profiles').update({ positions }).eq('id', me.id)
    if (error) throw new Error(friendlyError(error))
    await refreshProfile()
    setEditPositions(false)
  }

  if (player === undefined) return <Spinner />
  if (!player) return <div className="p-6 text-center text-muted">Jogador não encontrado.</div>

  const role = ROLE_LABEL[player.role]
  const both = player.goalkeeper === 'tambem'
  const keeperView = player.goalkeeper === 'so_goleiro' || (both && asKeeper)
  const canRate = me.type === 'mensalista' && (player.type === 'mensalista' || player.goalkeeper)

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
          {player.goalkeeper !== 'so_goleiro' && <span className="rounded-md bg-surface-2 px-2 py-0.5 text-silver">{TYPE_LABEL[player.type]}</span>}
          {role && <span className="rounded-md border border-line-2 px-2 py-0.5 text-muted">{role}</span>}
          {player.username && <span className="py-0.5 text-muted">@{player.username}</span>}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
          <PositionTags positions={player.positions} goalkeeper={player.goalkeeper} full />
          {isMe && (
            <button className="flex h-8 items-center gap-1 px-1 text-xs font-semibold text-action" onClick={() => setEditPositions(true)}>
              <Pencil size={13} />
              {player.positions?.length ? 'Editar funções' : 'Adicionar minhas funções'}
            </button>
          )}
        </div>
        {uploading && <div className="mt-2 text-xs text-muted">Enviando foto…</div>}
        {error && (
          <div className="mt-3 w-full">
            <Notice>{error}</Notice>
          </div>
        )}
      </div>

      {both && (
        <div className="mx-4 mb-2 flex items-center justify-between rounded-lg border border-line">
          <button className="flex h-11 w-11 items-center justify-center" aria-label="Ver como jogador" onClick={() => setAsKeeper((v) => !v)}>
            <ChevronLeft size={20} />
          </button>
          <span className="text-sm font-semibold">{asKeeper ? 'Como goleiro' : 'Como jogador'}</span>
          <button className="flex h-11 w-11 items-center justify-center" aria-label="Ver como goleiro" onClick={() => setAsKeeper((v) => !v)}>
            <ChevronRight size={20} />
          </button>
        </div>
      )}
      {keeperView ? (
        <>
          <StatsBlock profileId={player.id} view="goalkeeper_month_stats" fields={keeperStats(both)} />
          {both && <p className="px-4 pt-1 text-[11px] text-muted">* assistências dadas enquanto estava no gol</p>}
          <RatingsBlock profileId={player.id} view="goalkeeper_rating_summary" rows={GK_RATING_FIELDS} title="Notas de goleiro" />
        </>
      ) : (
        <>
          <StatsBlock profileId={player.id} />
          <RatingsBlock profileId={player.id} />
        </>
      )}

      <TrophiesBlock profileId={player.id} />

      <div className="px-4 pt-4">
        {isMe ? (
          <>
            {me.type === 'mensalista' && (
              <Link to="/notas" className="btn-outline flex w-full items-center justify-center">
                Avaliar colegas
              </Link>
            )}
            <PushSetting />
            <Link to="/trocar-senha" className="mt-2 flex h-11 w-full items-center justify-center text-sm text-muted">
              Trocar senha
            </Link>
          </>
        ) : (
          canRate && (
            <Link to={`/notas/${player.id}`} className="btn-outline flex w-full items-center justify-center">
              {player.type === 'mensalista' ? 'Avaliar este jogador' : 'Avaliar este goleiro'}
            </Link>
          )
        )}
      </div>
      {editPositions && <PositionsSheet value={me.positions} onSave={savePositions} onClose={() => setEditPositions(false)} />}
    </div>
  )
}
