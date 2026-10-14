import { ChevronRight, Flag, Pencil, Play, Plus, RotateCcw, Trash2, UserPlus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import DangerSheet from '../components/DangerSheet'
import FillSlotSheet from '../components/FillSlotSheet'
import Sheet from '../components/Sheet'
import TeamCard from '../components/TeamCard'
import { AddMemberSheet, MemberSheet, RestoreSheet } from '../components/TeamEditSheets'
import TeamShield from '../components/TeamShield'
import { Notice, SectionLabel, Spinner } from '../components/ui'
import { isAdminRole, useAuth } from '../lib/auth'
import { dayLabel, timeLabel } from '../lib/dates'
import { friendlyError } from '../lib/errors'
import { fetchPeladaGames, GAME_STATUS_LABEL, scoreOf, wonOnPenalties } from '../lib/games'
import { fetchCurrentPelada, PELADA_STATUS_LABEL } from '../lib/peladas'
import { supabase } from '../lib/supabase'
import { fetchTeams } from '../lib/teams'

function NextGameSheet({ pelada, teams, games, onClose, onDone }) {
  const pending = games.find((g) => g.status === 'agendado')
  const [t1, setT1] = useState(pending?.team1_id ?? null)
  const [t2, setT2] = useState(pending?.team2_id ?? null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const number = pending?.number ?? games.length + 1

  async function confirm() {
    setBusy(true)
    const { data, error } = await supabase.rpc('set_next_game', { p_pelada: pelada.id, p_team1: t1, p_team2: t2 })
    setBusy(false)
    if (error) setError(friendlyError(error))
    else onDone(data)
  }

  const picker = (value, onPick, other) => (
    <div className="grid grid-cols-2 gap-2">
      {teams.map((t) => (
        <button
          key={t.id}
          disabled={t.id === other}
          onClick={() => onPick(t.id)}
          className={`flex h-12 items-center gap-2 rounded-lg border px-2 text-left text-sm disabled:opacity-30 ${value === t.id ? 'border-action bg-action/15' : 'border-line-2'}`}
        >
          <TeamShield team={t} size={24} />
          <span className="truncate">{t.label}</span>
        </button>
      ))}
    </div>
  )

  return (
    <Sheet title="Quem joga o próximo jogo?" subtitle="O admin ou o ajudante escolhe os dois times, sem regra automática de quem fica ou sai." onClose={onClose}>
      <div className="text-xs font-semibold tracking-wide text-muted">PRÓXIMO JOGO · JOGO {number}</div>
      <div className="mt-2 mb-1 text-sm">Time 1</div>
      {picker(t1, setT1, t2)}
      <div className="mt-3 mb-1 text-sm">Time 2</div>
      {picker(t2, setT2, t1)}
      <div className="mt-3">
        <Notice>{error}</Notice>
      </div>
      <button className="btn mt-3 w-full" disabled={!t1 || !t2 || busy} onClick={confirm}>
        Confirmar próximo jogo
      </button>
      <button className="mt-2 h-11 w-full text-sm text-muted" onClick={onClose}>
        Cancelar
      </button>
    </Sheet>
  )
}

export default function PeladaHoje() {
  // sem id: a pelada de hoje (ou a próxima); com id: qualquer pelada, inclusive as antigas (Histórico)
  const { id } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const isAdmin = isAdminRole(profile)
  const isOwner = profile.role === 'dono'
  const [pelada, setPelada] = useState()
  const [teams, setTeams] = useState([])
  const [games, setGames] = useState([])
  const [events, setEvents] = useState([])
  const [present, setPresent] = useState(0)
  const [helpers, setHelpers] = useState([])
  const [drafting, setDrafting] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [fill, setFill] = useState(null)
  const [edit, setEdit] = useState(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const p = id ? (await supabase.from('peladas').select('*').eq('id', id).maybeSingle()).data : await fetchCurrentPelada()
    setPelada(p ?? null)
    if (!p) return
    const [t, g, { data: pres }, { data: help }, { data: draft }] = await Promise.all([
      fetchTeams(p.id),
      fetchPeladaGames(p.id),
      supabase.from('presence_list').select('answer, waitlisted').eq('pelada_id', p.id),
      supabase.from('pelada_helpers').select('profile_id').eq('pelada_id', p.id),
      supabase.from('drafts').select('phase').eq('pelada_id', p.id).maybeSingle(),
    ])
    const ids = (help ?? []).map((h) => h.profile_id)
    const { data: people } = ids.length ? await supabase.from('profiles').select('id, name').in('id', ids) : { data: [] }
    setTeams(t)
    setGames(g.games)
    setEvents(g.events)
    setPresent((pres ?? []).filter((r) => r.answer === 'vou' && !r.waitlisted).length)
    setHelpers(people ?? [])
    setDrafting(Boolean(draft && draft.phase !== 'concluida'))
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!pelada) return
    const channel = supabase
      .channel(`pelada-${pelada.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `pelada_id=eq.${pelada.id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_events' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members', filter: `pelada_id=eq.${pelada.id}` }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [pelada, load])

  if (pelada === undefined) return <Spinner />
  if (!pelada) {
    return (
      <div className="p-6 text-center text-muted">
        Nenhuma pelada marcada.
        {isAdmin && (
          <Link to="/admin/peladas/nova" className="btn mt-4 flex items-center justify-center">
            Criar pelada
          </Link>
        )}
      </div>
    )
  }

  const isHelper = helpers.some((h) => h.id === profile.id)
  const closed = pelada.status === 'encerrada'
  const canManage = (isAdmin || isHelper) && !closed
  const live = games.find((g) => g.status === 'ao_vivo')
  const allDone = games.length > 0 && games.every((g) => g.status === 'finalizado')
  const teamById = Object.fromEntries(teams.map((t) => [t.id, t]))
  // admin corrige os times a qualquer hora (até depois de encerrada), menos durante a escolha dos capitães
  const canEditTeams = isAdmin && !drafting
  const done = () => {
    setEdit(null)
    setFill(null)
    load()
  }

  async function reopen() {
    setBusy(true)
    setMsg('')
    const { error } = await supabase.rpc('reopen_pelada', { p_pelada: pelada.id })
    setBusy(false)
    setEdit(null)
    if (error) setMsg(friendlyError(error))
    else load()
  }

  return (
    <div className="pb-6">
      <div className="card mx-4 mt-3 flex items-center gap-3">
        <div className="flex-1">
          <div className="font-bold">
            {dayLabel(pelada.date)} · {timeLabel(pelada.start_time)}
          </div>
          <div className="text-xs text-muted">
            {pelada.location} · {closed || pelada.status === 'cancelada' ? PELADA_STATUS_LABEL[pelada.status] : `Presentes: ${present} de ${pelada.max_slots}`}
          </div>
        </div>
        <Link to={`/presenca/${pelada.id}`} className="text-xs font-semibold text-action">
          Presença
        </Link>
      </div>
      {(helpers.length > 0 || isAdmin) && (
        <div className="mx-4 mt-2 flex items-center gap-2 text-xs text-muted">
          <span className="min-w-0 flex-1 truncate">Ajudantes: {helpers.length ? helpers.map((h) => h.name.split(' ')[0]).join(', ') : 'nenhum'}</span>
          {isAdmin && !closed && (
            <Link to={`/admin/peladas/${pelada.id}`} className="font-semibold text-action">
              Trocar
            </Link>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pr-4">
        <SectionLabel>Times da pelada</SectionLabel>
        <Link to="/times" className="text-xs font-semibold text-action">
          Ver escolha
        </Link>
      </div>
      {teams.length === 0 ? (
        <div className="px-4 text-sm text-muted">
          Times ainda não montados.{' '}
          <Link to="/times" className="font-semibold text-action">
            Ver
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 px-4">
          {teams.map((t) => (
            <TeamCard
              key={t.id}
              team={t}
              onSlotClick={canManage || canEditTeams ? (slot, team) => setFill({ slot, team }) : undefined}
              onMemberClick={isAdmin ? (m) => setEdit({ kind: 'member', member: m, team: t }) : undefined}
              onAdd={canEditTeams ? (team) => setEdit({ kind: 'add', team }) : undefined}
              onRestore={canEditTeams ? (m, team) => setEdit({ kind: 'restore', member: m, team }) : undefined}
            />
          ))}
        </div>
      )}

      <SectionLabel>Jogos de hoje</SectionLabel>
      {games.length === 0 && <div className="px-4 text-sm text-muted">Nenhum jogo ainda.</div>}
      {games.map((g) => {
        const [a, b] = scoreOf(g, events)
        return (
          <Link key={g.id} to={`/jogo/${g.id}`} className="flex min-h-14 items-center gap-3 border-b border-row px-4 active:bg-surface-2">
            <span className="w-12 flex-none text-xs text-muted">Jogo {g.number}</span>
            <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-right">{teamById[g.team1_id]?.label}</span>
              <b className="text-base whitespace-nowrap tabular-nums">
                {a} x {b}
                {wonOnPenalties(g, events) && <span className="block text-center text-[10px] font-normal text-muted">pên.: {g.penalty_winner_id === g.team1_id ? '◀' : '▶'}</span>}
              </b>
              <span className="min-w-0 flex-1 truncate">{teamById[g.team2_id]?.label}</span>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${g.status === 'ao_vivo' ? 'bg-[#B3362B] text-white' : 'border border-line-2 text-muted'}`}>
              {GAME_STATUS_LABEL[g.status]}
            </span>
            <ChevronRight size={16} className="text-muted" />
          </Link>
        )
      })}

      <div className="space-y-2 px-4 pt-4">
        {live && (
          <Link to={`/jogo/${live.id}`} className="btn flex items-center justify-center gap-2">
            <Play size={18} /> Abrir jogo ao vivo
          </Link>
        )}
        {canManage && teams.length >= 2 && (
          <button className="btn-outline flex w-full items-center justify-center gap-2" onClick={() => setSheet(true)}>
            <Plus size={18} /> Definir próximo jogo
          </button>
        )}
        {isAdmin && teams.length > 0 && !closed && !id && (
          <Link to="/admin/diarista" className="btn-ghost flex items-center justify-center gap-2">
            <UserPlus size={18} /> Diarista no lugar de alguém
          </Link>
        )}
        {isAdmin && allDone && !closed && (
          <Link to={`/admin/encerrar/${pelada.id}`} className="btn-ghost flex items-center justify-center gap-2">
            <Flag size={18} /> Encerrar pelada
          </Link>
        )}
        {isAdmin && (
          <Link to={`/admin/peladas/${pelada.id}`} className="btn-ghost flex items-center justify-center gap-2">
            <Pencil size={16} /> Editar pelada (data, local, ajudantes)
          </Link>
        )}
        {isOwner && closed && (
          <button className="btn-ghost flex w-full items-center justify-center gap-2" disabled={busy} onClick={() => setEdit({ kind: 'reopen' })}>
            <RotateCcw size={16} /> Reabrir pelada
          </button>
        )}
        {isOwner && (
          <button className="flex h-11 w-full items-center justify-center gap-2 text-sm text-[#F29A8E]" onClick={() => setEdit({ kind: 'delete' })}>
            <Trash2 size={16} /> Excluir pelada
          </button>
        )}
        <Notice>{msg}</Notice>
      </div>

      {isAdmin && teams.length > 0 && (
        <p className="px-4 pt-2 text-xs text-muted">
          Admin: toque num jogador para marcar presença, trocar, mudar de time, tirar do time ou marcar que faltou (sai dos jogos e não conta vitória).
        </p>
      )}

      {edit?.kind === 'member' && (
        <MemberSheet
          pelada={pelada}
          team={edit.team}
          member={edit.member}
          teams={teams}
          hasGames={games.length > 0}
          editable={canEditTeams}
          onClose={() => setEdit(null)}
          onDone={done}
        />
      )}
      {edit?.kind === 'add' && <AddMemberSheet team={edit.team} teams={teams} onClose={() => setEdit(null)} onDone={done} />}
      {edit?.kind === 'restore' && <RestoreSheet team={edit.team} member={edit.member} onClose={() => setEdit(null)} onDone={done} />}
      {edit?.kind === 'reopen' && (
        <Sheet
          title="Reabrir esta pelada?"
          subtitle="Ela volta para em andamento e os números dela saem do mês até você encerrar de novo. Serve para corrigir algo e encerrar outra vez."
          onClose={() => setEdit(null)}
        >
          <button className="btn w-full" disabled={busy} onClick={reopen}>
            Reabrir pelada
          </button>
          <button className="mt-2 h-11 w-full text-sm text-muted" onClick={() => setEdit(null)}>
            Cancelar
          </button>
        </Sheet>
      )}
      {edit?.kind === 'delete' && (
        <DangerSheet
          title={`Excluir a pelada de ${dayLabel(pelada.date)}?`}
          subtitle={`Some tudo dela: times, ${games.length} ${games.length === 1 ? 'jogo' : 'jogos'}, gols, presença e avulsos, e os números saem do pódio. Dinheiro de diarista lançado no caixa é estornado.`}
          action="Excluir pelada"
          onClose={() => setEdit(null)}
          onConfirm={async (text) => {
            const res = await supabase.rpc('delete_pelada', { p_pelada: pelada.id, p_confirm: text })
            if (!res.error) navigate(id ? '/historico' : '/', { replace: true })
            return res
          }}
        />
      )}

      {fill && <FillSlotSheet slot={fill.slot} team={fill.team} teams={teams} canDelete={canEditTeams} onClose={() => setFill(null)} onDone={done} />}

      {sheet && (
        <NextGameSheet
          pelada={pelada}
          teams={teams}
          games={games}
          onClose={() => setSheet(false)}
          onDone={(gameId) => {
            setSheet(false)
            navigate(`/jogo/${gameId}`)
          }}
        />
      )}
    </div>
  )
}
