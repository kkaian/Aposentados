import { Clock, Shirt, Users } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar from '../components/Avatar'
import FillSlotSheet from '../components/FillSlotSheet'
import TeamCard from '../components/TeamCard'
import { Notice, SectionLabel, Spinner } from '../components/ui'
import { isAdminRole, useAuth } from '../lib/auth'
import { DRAFT_ORDER } from '../lib/constants'
import { dayLabel, timeLabel } from '../lib/dates'
import { friendlyError } from '../lib/errors'
import { fetchCurrentPelada } from '../lib/peladas'
import { photoUrl } from '../lib/storage'
import { supabase } from '../lib/supabase'
import { fetchTeams } from '../lib/teams'

const PICK_ORDER = DRAFT_ORDER.flat()

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

function countdown(ms) {
  if (ms <= 0) return '0min'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}min` : `${m}min ${String(s).padStart(2, '0')}s`
}

function OverallStars({ value }) {
  const pct = value ? (Number(value) / 5) * 100 : 0
  return (
    <span className="relative inline-block text-sm leading-none tracking-[2px] text-line">
      ★★★★★
      <i className="absolute top-0 left-0 overflow-hidden whitespace-nowrap text-silver not-italic" style={{ width: `${pct}%` }}>
        ★★★★★
      </i>
    </span>
  )
}

export default function Times() {
  const { profile } = useAuth()
  const isAdmin = isAdminRole(profile)
  const [pelada, setPelada] = useState()
  const [teams, setTeams] = useState([])
  const [draft, setDraft] = useState(null)
  const [available, setAvailable] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)
  const [isHelper, setIsHelper] = useState(false)
  const [fill, setFill] = useState(null)
  const ticking = useRef(false)
  const now = useNow()

  const load = useCallback(async () => {
    const p = await fetchCurrentPelada()
    setPelada(p ?? null)
    if (!p) return
    const [t, { data: d }, { data: h }] = await Promise.all([
      fetchTeams(p.id),
      supabase.from('drafts').select('*').eq('pelada_id', p.id).maybeSingle(),
      supabase.from('pelada_helpers').select('profile_id').eq('pelada_id', p.id),
    ])
    setIsHelper((h ?? []).some((x) => x.profile_id === profile.id))
    setTeams(t)
    setDraft(d)
    if (d && d.phase !== 'concluida') {
      const { data: ids } = await supabase.rpc('draft_available', { p_pelada: p.id })
      const list = (ids ?? []).map((r) => r.profile_id)
      if (list.length) {
        const [{ data: people }, { data: ratings }] = await Promise.all([
          supabase.from('profiles').select('id, name, photo_path, type').in('id', list),
          supabase.from('rating_summary').select('profile_id, overall').in('profile_id', list),
        ])
        const overall = Object.fromEntries((ratings ?? []).map((r) => [r.profile_id, r.overall]))
        setAvailable((people ?? []).map((p) => ({ ...p, overall: overall[p.id] })).sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0) || a.name.localeCompare(b.name)))
      } else setAvailable([])
    } else setAvailable([])
  }, [profile.id])

  useEffect(() => {
    load()
  }, [load])

  // escolha ao vivo para todos
  useEffect(() => {
    if (!pelada) return
    const channel = supabase
      .channel(`draft-${pelada.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members', filter: `pelada_id=eq.${pelada.id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drafts', filter: `pelada_id=eq.${pelada.id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: `pelada_id=eq.${pelada.id}` }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [pelada, load])

  // prazo vencido: pede ao servidor para aplicar o sorteio sem esperar o relógio de 1 min
  const deadline = draft?.phase === 'livre' ? Date.parse(draft.free_until) : draft?.phase === 'turnos' ? Date.parse(draft.turn_deadline) : null
  useEffect(() => {
    if (!deadline || now < deadline || ticking.current) return
    ticking.current = true
    supabase.rpc('draft_tick').then(() => {
      ticking.current = false
      load()
    })
  }, [now, deadline, load])

  async function pickSlot() {
    setBusy('slot')
    setError('')
    const { error } = await supabase.rpc('draft_pick_slot', { p_pelada: pelada.id })
    setBusy(null)
    if (error) setError(friendlyError(error))
    load()
  }

  async function pick(player) {
    setBusy(player.id)
    setError('')
    const { error } = await supabase.rpc('draft_pick', { p_pelada: pelada.id, p_profile: player.id })
    setBusy(null)
    if (error) setError(friendlyError(error))
    load()
  }

  if (pelada === undefined) return <Spinner />
  if (!pelada) return <div className="p-6 text-center text-muted">Nenhuma pelada marcada.</div>

  const header = (
    <div className="card mx-4 mt-3">
      <b>
        {dayLabel(pelada.date)} · {timeLabel(pelada.start_time)}
      </b>
      <div className="text-xs text-muted">{pelada.location}</div>
    </div>
  )

  if (teams.length === 0) {
    return (
      <div className="pb-6">
        {header}
        <div className="flex flex-col items-center px-8 pt-12 text-center">
          <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-surface text-muted">
            <Users size={30} />
          </span>
          <b className="text-lg">Times ainda não montados</b>
          <p className="mt-1 text-sm text-muted">O admin escolhe os 4 capitães e eles montam os times desta pelada.</p>
          {isAdmin && (
            <div className="mt-6 flex w-full flex-col gap-2">
              <Link to={`/admin/peladas/${pelada.id}/capitaes`} className="btn flex items-center justify-center">
                Definir capitães
              </Link>
              <Link to="/admin/sorteio" className="btn-ghost flex items-center justify-center">
                Sorteio (dia atípico)
              </Link>
            </div>
          )}
        </div>
      </div>
    )
  }

  const drafting = draft && draft.phase !== 'concluida'
  const turnOrder = drafting ? PICK_ORDER[draft.next_pick - 1] : null
  const turnTeam = teams.find((t) => t.captain_order === turnOrder)
  const myTeam = teams.find((t) => t.captain_id === profile.id)
  const myTurn = drafting && turnTeam?.captain_id === profile.id
  const canPick = drafting && (myTurn || isAdmin)
  const slots = teams.length === 4 && draft?.next_pick ? 5 : 0

  return (
    <div className="pb-6">
      {header}

      {drafting && (
        <div className={`mx-4 mt-3 rounded-xl border p-3 ${myTurn ? 'border-action bg-action/10' : 'border-line'}`}>
          <div className="text-xs font-semibold tracking-wide text-muted">
            4 CAPITÃES · ESCOLHA {Math.min(draft.next_pick, 16)} DE 16
          </div>
          <div className="mt-0.5 text-lg font-bold">{myTurn ? 'Sua vez, capitão!' : `Vez de ${turnTeam?.label ?? '…'}`}</div>
          <div className="mt-1 flex items-center gap-1.5 text-sm text-muted">
            <Clock size={15} />
            {draft.phase === 'livre'
              ? `Fase livre termina em ${countdown(deadline - now)}`
              : `Tempo para escolher: ${countdown(deadline - now)}`}
          </div>
        </div>
      )}

      {error && (
        <div className="px-4 pt-3">
          <Notice>{error}</Notice>
        </div>
      )}

      {myTeam && (
        <div className="px-4 pt-3">
          <Link to="/times/meu" className="btn-outline flex items-center justify-center gap-2">
            <Shirt size={18} /> Meu time: kit e cor
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 px-4 pt-3">
        {teams.map((t) => (
          <div key={t.id}>
            <TeamCard team={t} slots={slots} onSlotClick={isAdmin || isHelper ? (slot, team) => setFill({ slot, team }) : undefined} />
            {isAdmin && t.captain_id !== profile.id && (
              <Link to={`/times/meu?time=${t.id}`} className="block py-1.5 text-center text-xs font-semibold text-action">
                Editar kit e cor
              </Link>
            )}
          </div>
        ))}
      </div>

      {isAdmin && (
        <div className="flex gap-2 px-4 pt-3">
          <Link to={`/admin/peladas/${pelada.id}/capitaes`} className="btn-ghost flex flex-1 items-center justify-center text-sm">
            Refazer capitães
          </Link>
          <Link to="/admin/diarista" className="btn-ghost flex flex-1 items-center justify-center text-sm">
            Adicionar diarista
          </Link>
        </div>
      )}

      {drafting && (
        <>
          <SectionLabel>Disponíveis · {available.length}</SectionLabel>
          {available.length === 0 && (
            <div className="px-4">
              <div className="text-sm text-muted">Ninguém disponível. Só entra quem confirmou presença.</div>
              {canPick && (
                <button className="btn-outline mt-3 w-full" disabled={busy !== null} onClick={pickSlot}>
                  Escolher vaga de diarista
                </button>
              )}
              <p className="mt-2 text-xs text-muted">A vaga é preenchida no dia com quem aparecer: avulso, diarista com conta ou mensalista de última hora.</p>
            </div>
          )}
          {available.map((p) => (
            <div key={p.id} className="flex min-h-14 items-center gap-3 border-b border-row px-4">
              <Avatar name={p.name} src={photoUrl(p.photo_path)} />
              <div className="min-w-0 flex-1">
                <div className="truncate">{p.name}</div>
                <OverallStars value={p.overall} />
              </div>
              {canPick && (
                <button className="btn h-9 px-3 text-sm" disabled={busy !== null} onClick={() => pick(p)}>
                  Escolher
                </button>
              )}
            </div>
          ))}
          <p className="px-4 pt-3 text-xs text-muted">
            Ordem por rodada: 1-2-3-4 · 4-1-2-3 · 1-2-3-4 · 1-2-3-4. Primeiras 24 h livres; depois, 10 min por escolha. Sem
            escolha, o app sorteia. Os times valem só para esta pelada.
          </p>
        </>
      )}
      {fill && (
        <FillSlotSheet
          slot={fill.slot}
          team={fill.team}
          teams={teams}
          onClose={() => setFill(null)}
          onDone={() => {
            setFill(null)
            load()
          }}
        />
      )}
    </div>
  )
}
