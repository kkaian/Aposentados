import { ArrowLeftRight, ChevronLeft, Hand, Lock, Pencil, Play, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import DangerSheet from '../components/DangerSheet'
import Sheet from '../components/Sheet'
import TeamShield from '../components/TeamShield'
import { Notice, SectionLabel, Spinner } from '../components/ui'
import { isAdminRole, useAuth } from '../lib/auth'
import { dayLabel } from '../lib/dates'
import { friendlyError } from '../lib/errors'
import { currentKeeper, describeEvent, EVENT_LABEL, fetchGame, GAME_GOALS, GAME_MINUTES, makeNamer, minuteOf, scoreOf } from '../lib/games'
import { photoUrl } from '../lib/storage'
import { supabase } from '../lib/supabase'

const keyOf = (pid, gid) => (pid ? `p:${pid}` : `g:${gid}`)
const idFields = (prefix, person) =>
  person.profile_id ? { [`${prefix}_id`]: person.profile_id } : { [`${prefix}_guest_id`]: person.guest_id }

function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

function clock(game, now, minutes, goals) {
  if (game.status === 'agendado') return `${minutes}:00 · ou ${goals} gols`
  if (game.status === 'finalizado') return 'Finalizado'
  const left = Math.max(0, minutes * 60 - Math.floor((now - Date.parse(game.started_at)) / 1000))
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · ou ${goals} gols`
}

function Btn({ children, className = '', ...props }) {
  return (
    <button className={`h-14 w-full rounded-lg border border-line-2 bg-bg font-semibold ${className}`} {...props}>
      {children}
    </button>
  )
}

export default function Jogo() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const isAdmin = isAdminRole(profile)
  const [data, setData] = useState()
  const [sheet, setSheet] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const endShownFor = useRef(null)
  const now = useNow()

  const load = useCallback(() => fetchGame(id).then(setData), [id])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const channel = supabase
      .channel(`game-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_events', filter: `game_id=eq.${id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_lineup', filter: `game_id=eq.${id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_keepers', filter: `game_id=eq.${id}` }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [id, load])

  const game = data?.game
  const score = data ? scoreOf(game, data.events) : [0, 0]
  const tied = score[0] === score[1]
  // qualquer admin ou ajudante da pelada registra (quem iniciou também)
  const isHelper = Boolean(data?.helperIds.includes(profile.id))
  const canManage = isAdmin || isHelper || game?.recorder_id === profile.id
  const canRecord = game && ((game.status === 'ao_vivo' && canManage) || (isAdmin && game.status !== 'agendado'))

  // fim do jogo: regra da pelada (padrão 10 min ou 2 gols) -> tela de placar final para quem registra
  const gameMinutes = data?.pelada?.game_minutes ?? GAME_MINUTES
  const gameGoals = data?.pelada?.game_goals ?? GAME_GOALS
  const reachedEnd = game?.status === 'ao_vivo' && (Math.max(...score) >= gameGoals || minuteOf(game, now) >= gameMinutes)
  const endKey = reachedEnd ? `${score.join('-')}-${minuteOf(game, now) >= gameMinutes}` : null
  useEffect(() => {
    if (endKey && canManage && endShownFor.current !== endKey && !sheet) {
      endShownFor.current = endKey
      setSheet({ kind: 'fim' })
    }
  }, [endKey, canManage, sheet])

  if (data === undefined) return <Spinner />
  if (!data) return <div className="p-6 text-center text-muted">Jogo não encontrado.</div>

  const { pelada, team1, team2, lineup, events, guests, profiles, helperIds, keepers, goingIds } = data
  const name = makeNamer(profiles, guests)
  const photoOf = Object.fromEntries(profiles.map((p) => [p.id, p.photo_path]))
  // goleiro: admin ou ajudante define antes e durante o jogo; encerrado, só admin corrige
  const canSetKeeper = game.status === 'finalizado' ? isAdmin : isAdmin || helperIds.includes(profile.id) || game.recorder_id === profile.id
  // quem agarrou por este time neste jogo não aparece na linha
  const keptFor = (teamId) =>
    new Set(keepers.filter((k) => k.team_id === teamId && k.profile_id && (game.status === 'finalizado' || k.left_minute == null)).map((k) => k.profile_id))
  const penaltyTeam = [team1, team2].find((t) => t && t.id === game.penalty_winner_id)
  const canStart = game.status === 'agendado' && (isAdmin || helperIds.includes(profile.id))
  // jogo encerrado: mostra todos que jogaram (sem repetir); ao vivo: só quem está em campo
  const inField = (teamId) => {
    const kept = keptFor(teamId)
    if (game.status !== 'finalizado') return lineup.filter((l) => l.team_id === teamId && l.left_minute == null && !kept.has(l.profile_id))
    const seen = new Set()
    return lineup.filter((l) => {
      const k = keyOf(l.profile_id, l.guest_id)
      if (l.team_id !== teamId || seen.has(k) || kept.has(l.profile_id)) return false
      seen.add(k)
      return true
    })
  }
  // números do goleiro neste jogo: defesas difíceis e gols sofridos enquanto estava no gol
  const keeperStats = (k) => {
    const rival = k.team_id === game.team1_id ? game.team2_id : game.team1_id
    const stints = keepers.filter((x) => x.team_id === k.team_id && x.profile_id === k.profile_id)
    const inStint = (m) => stints.some((x) => m >= x.entered_minute && (x.left_minute == null || m < x.left_minute))
    const conceded = events.filter((e) => ((e.type === 'gol' && e.team_id === rival) || (e.type === 'gol_contra' && e.team_id === k.team_id)) && inStint(e.minute)).length
    const saves = events.filter((e) => e.type === 'defesa_dificil' && e.player_id === k.profile_id && e.team_id === k.team_id).length
    return `${saves} DD · ${conceded} GS`
  }
  const statsOf = (l) => {
    const k = keyOf(l.profile_id, l.guest_id)
    const goals = events.filter((e) => e.type === 'gol' && keyOf(e.player_id, e.player_guest_id) === k).length
    const assists = events.filter((e) => e.type === 'gol' && (e.assist_id || e.assist_guest_id) && keyOf(e.assist_id, e.assist_guest_id) === k).length
    return `${goals}G · ${assists}A`
  }
  const minuteNow = game.status === 'ao_vivo' ? Math.min(60, minuteOf(game, now)) : (events.at(-1)?.minute ?? gameMinutes)

  async function rpc(fn, args, after) {
    setBusy(true)
    setMsg('')
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) setMsg(friendlyError(error))
    else {
      after?.()
      load()
    }
  }

  // grava um evento; se falhar, oferece tentar de novo
  async function record(row, label) {
    setBusy(true)
    const { error } = await supabase.from('game_events').insert({ game_id: game.id, minute: minuteNow, ...row })
    setBusy(false)
    if (error) setSheet({ kind: 'erro', label, message: friendlyError(error), retry: () => record(row, label) })
    else {
      setSheet(null)
      load()
    }
  }

  // goleiro do time: toque para registrar (ao vivo) ou definir/trocar
  const keeperBox = (team) => {
    const k = team && currentKeeper(keepers, team.id)
    if (k?.profile_id) {
      return (
        <button
          disabled={!canRecord && !canSetKeeper}
          onClick={() => setSheet(canRecord ? { kind: 'acao_gk', keeper: k } : { kind: 'goleiro', team })}
          className="mb-1.5 flex w-full items-center gap-2 rounded-lg border border-gold/50 p-1.5 text-left disabled:opacity-100"
        >
          <Avatar name={name(k.profile_id)} src={photoUrl(photoOf[k.profile_id])} size={32} />
          <div className="min-w-0">
            <div className="flex items-center gap-1 truncate text-sm">
              <Hand size={13} className="flex-none text-gold" /> {name(k.profile_id)}
            </div>
            <div className="text-[11px] text-muted">{keeperStats(k)}</div>
          </div>
        </button>
      )
    }
    return (
      <button
        disabled={!canSetKeeper}
        onClick={() => setSheet({ kind: 'goleiro', team })}
        className="mb-1.5 flex h-9 w-full items-center gap-1.5 rounded-lg border border-dashed border-line-2 px-2 text-left text-xs text-muted disabled:opacity-100"
      >
        <Hand size={13} className="flex-none text-gold" />
        <span className="flex-1 truncate">{k ? 'Goleiro avulso' : 'Sem goleiro'}</span>
        {canSetKeeper && <span className="font-semibold text-action">{k ? 'Trocar' : 'Definir'}</span>}
      </button>
    )
  }

  const teamColumn = (team) => (
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-1.5 text-sm font-bold">
          <TeamShield team={team} size={20} />
          <span className="truncate">{team?.label}</span>
        </div>
        {keeperBox(team)}
        {inField(team?.id).map((l) => (
          <button
            key={l.id}
            disabled={!canRecord}
            onClick={() => setSheet({ kind: 'acao', person: l })}
            className="mb-1.5 flex w-full items-center gap-2 rounded-lg border border-line p-1.5 text-left disabled:opacity-100"
          >
            <Avatar name={name(l.profile_id, l.guest_id)} src={photoUrl(photoOf[l.profile_id])} size={32} />
            <div className="min-w-0">
              <div className="truncate text-sm">{name(l.profile_id, l.guest_id)}</div>
              <div className="text-[11px] text-muted">{statsOf(l)}</div>
            </div>
          </button>
        ))}
        {inField(team?.id).length === 0 && game.status === 'agendado' && <div className="text-xs text-muted">Elenco entra ao iniciar o jogo.</div>}
        {game.status === 'ao_vivo' && canManage && (
          <button className="mt-1 h-9 w-full rounded-lg border border-dashed border-line-2 text-xs font-semibold text-action" onClick={() => setSheet({ kind: 'lend', team })}>
            + Emprestar jogador
          </button>
        )}
      </div>
  )

  return (
    <div className="pb-6">
      <div className="border-b border-line px-4 pt-1 pb-3 text-center">
        <button
          className="-ml-2 flex h-10 items-center gap-0.5 pr-2 text-sm font-semibold text-action"
          onClick={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate(`/pelada/${pelada.id}`))}
        >
          <ChevronLeft size={20} /> Voltar
        </button>
        <div className="text-xs text-muted">
          Jogo {game.number} ·{' '}
          <Link to={`/pelada/${pelada.id}`} className="font-semibold text-action">
            pelada de {dayLabel(pelada.date)}
          </Link>
        </div>
        <div className="mt-2 flex items-center justify-center gap-3">
          <div className="flex flex-1 flex-col items-center gap-1">
            <TeamShield team={team1} size={40} />
            <span className="line-clamp-1 text-sm">{team1?.label}</span>
          </div>
          <b className="text-4xl tabular-nums">
            {score[0]} : {score[1]}
          </b>
          <div className="flex flex-1 flex-col items-center gap-1">
            <TeamShield team={team2} size={40} />
            <span className="line-clamp-1 text-sm">{team2?.label}</span>
          </div>
        </div>
        <div className={`mt-1 text-sm tabular-nums ${reachedEnd ? 'text-gold' : 'text-muted'}`}>{clock(game, now, gameMinutes, gameGoals)}</div>
        {tied && game.status === 'finalizado' && (
          <div className="mt-1 text-sm text-muted">
            {penaltyTeam ? `${penaltyTeam.label} venceu nos pênaltis` : 'Empate'}
            {isAdmin && (
              <button className="ml-2 text-xs font-semibold text-action" onClick={() => setSheet({ kind: 'penaltis' })}>
                Alterar
              </button>
            )}
          </div>
        )}
      </div>

      {game.status === 'ao_vivo' && !canManage && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-line bg-surface p-3 text-sm text-muted">
          <Lock size={16} className="mt-0.5 flex-none" />
          <span>Admins e ajudantes desta pelada registram os eventos. Você acompanha ao vivo.</span>
        </div>
      )}

      {game.status === 'finalizado' && (
        <div className="px-4 pt-3">
          <button className="btn w-full" onClick={() => navigate(`/pelada/${pelada.id}`)}>
            Voltar para a pelada
          </button>
        </div>
      )}

      {canStart && (
        <div className="px-4 pt-3">
          <button className="btn flex w-full items-center justify-center gap-2" disabled={busy} onClick={() => rpc('start_game', { p_game: game.id })}>
            <Play size={18} /> Iniciar jogo e cronômetro
          </button>
          <p className="mt-1 text-xs text-muted">Admins e ajudantes desta pelada registram os eventos juntos.</p>
        </div>
      )}

      {msg && (
        <div className="px-4 pt-3">
          <Notice>{msg}</Notice>
        </div>
      )}

      {canRecord && (
        <p className="px-4 pt-3 text-xs text-muted">
          {game.status === 'finalizado' ? 'Jogo encerrado: como admin, você ainda pode registrar, editar e excluir eventos.' : 'Toque no jogador para registrar. Só admin edita e exclui eventos.'}
        </p>
      )}

      <div className="flex gap-3 px-4 pt-3">
        {teamColumn(team1)}
        {teamColumn(team2)}
      </div>

      <SectionLabel>{game.status === 'finalizado' ? 'Linha do tempo' : 'Últimos eventos'}</SectionLabel>
      {events.length === 0 && <div className="px-4 text-sm text-muted">Nenhum evento ainda.</div>}
      {[...events].reverse().map((e) => {
        const d = describeEvent(e, name)
        return (
          <div key={e.id} className="flex min-h-12 items-center gap-3 border-b border-row px-4 py-1.5">
            <b className="w-8 text-sm text-muted tabular-nums">{e.minute}'</b>
            <div className="min-w-0 flex-1">
              <div className="text-sm">{d.title}</div>
              {d.sub && <div className="text-xs text-muted">{d.sub}</div>}
            </div>
            {isAdmin && (
              <>
                {e.type !== 'substituicao' && e.type !== 'defesa_dificil' && (
                  <button className="flex h-10 w-10 items-center justify-center text-muted" aria-label="Editar" onClick={() => setSheet({ kind: 'edit', event: e })}>
                    <Pencil size={16} />
                  </button>
                )}
                <button className="flex h-10 w-10 items-center justify-center text-muted" aria-label="Excluir" onClick={() => setSheet({ kind: 'delete', event: e })}>
                  <Trash2 size={16} />
                </button>
              </>
            )}
          </div>
        )
      })}

      {game.status === 'ao_vivo' && canManage && (
        <div className="px-4 pt-4">
          <button className="btn-ghost w-full" onClick={() => setSheet({ kind: 'fim' })}>
            Encerrar jogo
          </button>
        </div>
      )}

      {profile.role === 'dono' && (
        <div className="px-4 pt-4">
          <button className="flex h-11 w-full items-center justify-center gap-2 text-sm text-[#F29A8E]" onClick={() => setSheet({ kind: 'excluir' })}>
            <Trash2 size={16} /> Excluir jogo
          </button>
        </div>
      )}

      {sheet?.kind === 'acao' && (
        <Sheet title={name(sheet.person.profile_id, sheet.person.guest_id)} subtitle={`${sheet.person.team_id === team1?.id ? team1?.label : team2?.label} · ${statsOf(sheet.person)}`} onClose={() => setSheet(null)}>
          <div className="mb-2 text-sm font-semibold">O que aconteceu?</div>
          <div className="grid grid-cols-2 gap-2">
            <Btn className="col-span-2 border-action bg-action text-white" onClick={() => setSheet({ kind: 'assist', person: sheet.person })}>
              Gol
            </Btn>
            <Btn onClick={() => record({ type: 'gol_contra', team_id: sheet.person.team_id, ...idFields('player', sheet.person) }, 'o gol contra')}>Gol contra</Btn>
            <Btn onClick={() => setSheet({ kind: 'sub', person: sheet.person })}>
              <ArrowLeftRight size={16} className="mr-1 inline" /> Substituição
            </Btn>
            <Btn className="text-[#E0B000]" onClick={() => record({ type: 'amarelo', team_id: sheet.person.team_id, ...idFields('player', sheet.person) }, 'o cartão')}>
              Cartão amarelo
            </Btn>
            <Btn className="text-[#E5604F]" onClick={() => record({ type: 'vermelho', team_id: sheet.person.team_id, ...idFields('player', sheet.person) }, 'o cartão')}>
              Cartão vermelho
            </Btn>
          </div>
          <div className="mt-4 mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Corrigir</div>
          <button className="flex min-h-12 w-full items-center border-b border-row text-left" onClick={() => setSheet({ kind: 'naojogou', person: sheet.person })}>
            Não jogou este jogo (tirar do jogo)
          </button>
          {isAdmin && (
            <button className="flex min-h-12 w-full items-center border-b border-row text-left text-[#F29A8E]" onClick={() => setSheet({ kind: 'faltou', person: sheet.person })}>
              Faltou à pelada (tirar de todos os jogos)
            </button>
          )}
          <button className="mt-3 h-11 w-full text-sm text-muted" onClick={() => setSheet(null)}>
            Cancelar
          </button>
        </Sheet>
      )}

      {sheet?.kind === 'acao_gk' && (
        <Sheet
          title={name(sheet.keeper.profile_id)}
          subtitle={`Goleiro do ${sheet.keeper.team_id === team1?.id ? team1?.label : team2?.label} · ${keeperStats(sheet.keeper)}`}
          onClose={() => setSheet(null)}
        >
          <div className="mb-2 text-sm font-semibold">O que aconteceu?</div>
          <div className="grid grid-cols-2 gap-2">
            <Btn
              className="col-span-2 border-gold bg-gold/15 text-gold"
              disabled={busy}
              onClick={() => record({ type: 'defesa_dificil', team_id: sheet.keeper.team_id, player_id: sheet.keeper.profile_id }, 'a defesa')}
            >
              <Hand size={16} className="mr-1 inline" /> Defesa difícil
            </Btn>
            <Btn onClick={() => setSheet({ kind: 'assist', person: { ...sheet.keeper, id: `gk-${sheet.keeper.id}`, guest_id: null }, keeper: sheet.keeper })}>Gol</Btn>
            <Btn onClick={() => record({ type: 'gol_contra', team_id: sheet.keeper.team_id, player_id: sheet.keeper.profile_id }, 'o gol contra')}>Gol contra</Btn>
          </div>
          {canSetKeeper && (
            <button
              className="mt-3 flex min-h-12 w-full items-center border-b border-row text-left"
              onClick={() => setSheet({ kind: 'goleiro', team: sheet.keeper.team_id === team1?.id ? team1 : team2 })}
            >
              Trocar goleiro
            </button>
          )}
          <button className="mt-3 h-11 w-full text-sm text-muted" onClick={() => setSheet(null)}>
            Cancelar
          </button>
        </Sheet>
      )}

      {sheet?.kind === 'goleiro' && (
        <KeeperSheet
          team={sheet.team}
          game={game}
          teams={[team1, team2]}
          keepers={keepers}
          lineup={lineup}
          profiles={profiles}
          goingIds={goingIds}
          busy={busy}
          msg={msg}
          onClose={() => setSheet(null)}
          onConfirm={(choice) =>
            rpc('set_keeper', { p_game: game.id, p_team: sheet.team.id, p_profile: choice.profile_id ?? null, p_avulso: choice.avulso ?? false }, () => setSheet(null))
          }
        />
      )}

      {sheet?.kind === 'assist' && (
        <Sheet title="Teve assistência?" subtitle={`Gol de ${name(sheet.person.profile_id, sheet.person.guest_id)} · passo 2 de 2`} onClose={() => setSheet(null)}>
          <div className="space-y-2">
            {[
              ...inField(sheet.person.team_id),
              // o goleiro do time também dá assistência
              ...[currentKeeper(keepers, sheet.person.team_id)].filter((k) => k?.profile_id).map((k) => ({ ...k, id: `gk-${k.id}`, guest_id: null })),
            ]
              .filter((l) => l.id !== sheet.person.id && !(l.profile_id && l.profile_id === sheet.person.profile_id))
              .map((l) => (
                <Btn
                  key={l.id}
                  disabled={busy}
                  onClick={() =>
                    record({ type: 'gol', team_id: sheet.person.team_id, ...idFields('player', sheet.person), ...idFields('assist', l) }, 'o gol')
                  }
                >
                  {name(l.profile_id, l.guest_id)}
                </Btn>
              ))}
            <Btn className="border-action text-action" disabled={busy} onClick={() => record({ type: 'gol', team_id: sheet.person.team_id, ...idFields('player', sheet.person) }, 'o gol')}>
              Sem assistência
            </Btn>
          </div>
          <button
            className="mt-3 h-11 w-full text-sm text-muted"
            onClick={() => setSheet(sheet.keeper ? { kind: 'acao_gk', keeper: sheet.keeper } : { kind: 'acao', person: sheet.person })}
          >
            Voltar
          </button>
        </Sheet>
      )}

      {sheet?.kind === 'sub' && (
        <SubSheet
          person={sheet.person}
          name={name}
          lineup={lineup}
          profiles={profiles}
          guests={guests}
          busy={busy}
          onClose={() => setSheet(null)}
          onConfirm={async (incoming) => {
            let sub = incoming
            if (incoming.newGuest) {
              const { data: guestId, error } = await supabase.rpc('add_guest', { p_pelada: pelada.id, p_name: incoming.newGuest })
              if (error) return setSheet({ kind: 'erro', label: 'a substituição', message: friendlyError(error) })
              sub = { guest_id: guestId }
            }
            record({ type: 'substituicao', team_id: sheet.person.team_id, ...idFields('player', sheet.person), ...idFields('sub_in', sub) }, 'a substituição')
          }}
        />
      )}

      {sheet?.kind === 'lend' && (
        <LendSheet
          team={sheet.team}
          lineup={lineup}
          profiles={profiles}
          guests={guests}
          onClose={() => setSheet(null)}
          onConfirm={async (choice) => {
            const { error } = await supabase.rpc('lend_player', {
              p_game: game.id,
              p_team: sheet.team.id,
              p_profile: choice.profile_id ?? null,
              p_guest_name: choice.profile_id ? null : choice.name,
            })
            if (error) setMsg(friendlyError(error))
            setSheet(null)
            load()
          }}
        />
      )}


      {sheet?.kind === 'fim' && (
        <Sheet onClose={() => setSheet(null)}>
          <div className="text-center">
            <div className="text-xs font-semibold tracking-wide text-gold">
              JOGO {game.number} {reachedEnd ? (Math.max(...score) >= gameGoals ? `ENCERRADO · CHEGOU A ${gameGoals} GOLS` : `ENCERRADO · ${gameMinutes} MINUTOS`) : 'ENCERRAR'}
            </div>
            <div className="mt-2 text-5xl font-bold tabular-nums">
              {score[0]} x {score[1]}
            </div>
            <div className="mt-1 text-sm text-muted">
              {team1?.label} x {team2?.label} · {minuteOf(game, now)} min
            </div>
          </div>
          {tied ? (
            <>
              <div className="mt-5 mb-2 text-center text-sm text-muted">Empatou. Teve pênaltis?</div>
              <button className="btn w-full" disabled={busy} onClick={() => rpc('finish_game', { p_game: game.id }, () => setSheet(null))}>
                Empate (sem vencedor)
              </button>
              {[team1, team2].map((t) => (
                <button
                  key={t?.id}
                  className="btn-outline mt-2 flex w-full items-center justify-center gap-2"
                  disabled={busy}
                  onClick={() => rpc('finish_game', { p_game: game.id, p_penalty_winner: t.id }, () => setSheet(null))}
                >
                  <TeamShield team={t} size={18} /> {t?.label} venceu nos pênaltis
                </button>
              ))}
            </>
          ) : (
            <button className="btn mt-5 w-full" disabled={busy} onClick={() => rpc('finish_game', { p_game: game.id }, () => setSheet(null))}>
              Salvar resultado
            </button>
          )}
          <button className="mt-2 h-11 w-full text-sm text-muted" onClick={() => setSheet(null)}>
            Voltar ao jogo
          </button>
          <p className="text-center text-xs text-muted">Para corrigir o placar, edite os eventos. Depois de salvar, só admin edita.</p>
        </Sheet>
      )}

      {sheet?.kind === 'penaltis' && (
        <Sheet title="Resultado do empate" subtitle={`Jogo ${game.number} · ${score[0]} x ${score[1]}`} onClose={() => setSheet(null)}>
          {[null, team1?.id, team2?.id].map((teamId) => (
            <button
              key={teamId ?? 'empate'}
              className={`${game.penalty_winner_id === teamId ? 'btn' : 'btn-outline'} mt-2 w-full`}
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                const { error } = await supabase.from('games').update({ penalty_winner_id: teamId }).eq('id', game.id)
                setBusy(false)
                if (error) setMsg(friendlyError(error))
                setSheet(null)
                load()
              }}
            >
              {teamId ? `${[team1, team2].find((t) => t?.id === teamId)?.label} venceu nos pênaltis` : 'Empate (sem vencedor)'}
            </button>
          ))}
        </Sheet>
      )}

      {sheet?.kind === 'erro' && (
        <Sheet title={`Não foi possível salvar ${sheet.label}`} subtitle={`${sheet.message} O evento ainda não aparece na lista.`} onClose={() => setSheet(null)}>
          {sheet.retry && (
            <button className="btn w-full" disabled={busy} onClick={sheet.retry}>
              Tentar de novo
            </button>
          )}
          <button className="mt-2 h-11 w-full text-sm text-muted" onClick={() => setSheet(null)}>
            Cancelar
          </button>
        </Sheet>
      )}

      {sheet?.kind === 'edit' && <EditEventSheet event={sheet.event} lineup={lineup} name={name} onClose={() => setSheet(null)} onSaved={load} />}

      {sheet?.kind === 'delete' && (
        <Sheet title="Excluir evento?" subtitle={`${describeEvent(sheet.event, name).title} (${sheet.event.minute}'). ${sheet.event.type === 'substituicao' ? 'A troca em campo é desfeita.' : ''}`} onClose={() => setSheet(null)}>
          <button
            className="btn w-full border-[#B3362B] bg-[#B3362B]"
            onClick={async () => {
              const { error } = await supabase.from('game_events').delete().eq('id', sheet.event.id)
              if (error) setMsg(friendlyError(error))
              setSheet(null)
              load()
            }}
          >
            Excluir evento
          </button>
          <button className="mt-2 h-11 w-full text-sm text-muted" onClick={() => setSheet(null)}>
            Cancelar
          </button>
        </Sheet>
      )}

      {sheet?.kind === 'naojogou' && (
        <Sheet
          title={`${name(sheet.person.profile_id, sheet.person.guest_id)} não jogou?`}
          subtitle={`Sai do jogo ${game.number}: não conta jogo nem vitória. Substituições dele somem da linha do tempo, mas quem entrou no lugar continua. Também serve para desfazer um empréstimo.`}
          onClose={() => setSheet(null)}
        >
          <button
            className="btn w-full"
            disabled={busy}
            onClick={() => rpc('remove_from_game', { p_game: game.id, p_profile: sheet.person.profile_id ?? null, p_guest: sheet.person.guest_id ?? null }, () => setSheet(null))}
          >
            Tirar do jogo
          </button>
          <p className="mt-1 text-xs text-muted">Se ele tiver gol, assistência ou cartão neste jogo, exclua esses eventos antes.</p>
          <div className="mt-2">
            <Notice>{msg}</Notice>
          </div>
          <button className="mt-2 h-11 w-full text-sm text-muted" onClick={() => setSheet(null)}>
            Cancelar
          </button>
        </Sheet>
      )}

      {sheet?.kind === 'faltou' && (
        <Sheet
          title={`${name(sheet.person.profile_id, sheet.person.guest_id)} faltou?`}
          subtitle="Sai de todos os jogos desta pelada e do time: não conta jogo, vitória nem Seleção do mês. Quem entrou no lugar dele continua valendo."
          onClose={() => setSheet(null)}
        >
          <button
            className="btn w-full border-[#B3362B] bg-[#B3362B]"
            disabled={busy}
            onClick={() => rpc('mark_absent', { p_pelada: pelada.id, p_profile: sheet.person.profile_id ?? null, p_guest: sheet.person.guest_id ?? null }, () => setSheet(null))}
          >
            Marcar que faltou
          </button>
          <p className="mt-1 text-xs text-muted">
            {pelada.status === 'encerrada' ? 'Pelada encerrada: ele só sai, sem abrir vaga.' : 'Fica uma vaga de diarista no time dele.'} Se ele tiver gol, assistência ou cartão, exclua esses eventos antes.
          </p>
          <div className="mt-2">
            <Notice>{msg}</Notice>
          </div>
          <button className="mt-2 h-11 w-full text-sm text-muted" onClick={() => setSheet(null)}>
            Cancelar
          </button>
        </Sheet>
      )}

      {sheet?.kind === 'excluir' && (
        <DangerSheet
          title={`Excluir o jogo ${game.number}?`}
          subtitle={`${team1?.label} ${score[0]} x ${score[1]} ${team2?.label}. Somem os gols, cartões e quem jogou. Os jogos seguintes mudam de número.`}
          action="Excluir jogo"
          onClose={() => setSheet(null)}
          onConfirm={async (text) => {
            const res = await supabase.rpc('delete_game', { p_game: game.id, p_confirm: text })
            if (!res.error) navigate(`/pelada/${pelada.id}`, { replace: true })
            return res
          }}
        />
      )}
    </div>
  )
}

// Goleiro do time: goleiros que confirmaram presença, goleiro avulso ou sem goleiro.
// Quem joga por um dos dois times deste jogo não aparece (senão fica duas vezes em campo).
function KeeperSheet({ team, game, teams, keepers, lineup, profiles, goingIds, busy, msg, onClose, onConfirm }) {
  const current = currentKeeper(keepers, team.id)
  const rival = team.id === game.team1_id ? game.team2_id : game.team1_id
  const playing = new Set([
    ...teams.filter((t) => t && [game.team1_id, game.team2_id].includes(t.id)).flatMap((t) => t.active.map((m) => m.profile_id)),
    ...lineup.filter((l) => l.left_minute == null).map((l) => l.profile_id),
    ...keepers.filter((k) => k.team_id === rival && k.left_minute == null).map((k) => k.profile_id),
  ])
  const options = profiles.filter((p) => p.goalkeeper && goingIds.has(p.id) && !playing.has(p.id))
  const [choice, setChoice] = useState(() =>
    current ? (current.profile_id ? { key: current.profile_id, profile_id: current.profile_id } : { key: 'avulso', avulso: true }) : { key: 'nenhum' },
  )

  return (
    <Sheet
      title={`Goleiro do ${team.label}`}
      subtitle={game.status === 'ao_vivo' ? 'A troca vale a partir de agora: os gols sofridos antes ficam com quem estava no gol.' : 'Vale para o jogo todo.'}
      onClose={onClose}
    >
      <div className="max-h-[45dvh] overflow-y-auto">
        {options.map((p) => (
          <label key={p.id} className="flex min-h-12 items-center gap-3 border-b border-row">
            <input type="radio" name="gk" className="h-5 w-5 accent-action" checked={choice.key === p.id} onChange={() => setChoice({ key: p.id, profile_id: p.id })} />
            <span className="flex-1">{p.name}</span>
            <span className="text-xs text-muted">{p.goalkeeper === 'so_goleiro' ? 'goleiro' : 'também goleiro'}</span>
          </label>
        ))}
        {options.length === 0 && <div className="py-2 text-sm text-muted">Nenhum goleiro confirmado. O admin pode marcar a presença dele.</div>}
        <label className="flex min-h-12 items-center gap-3 border-b border-row">
          <input type="radio" name="gk" className="h-5 w-5 accent-action" checked={choice.key === 'avulso'} onChange={() => setChoice({ key: 'avulso', avulso: true })} />
          <span className="flex-1">Goleiro avulso</span>
          <span className="text-xs text-muted">sem estatística</span>
        </label>
        <label className="flex min-h-12 items-center gap-3">
          <input type="radio" name="gk" className="h-5 w-5 accent-action" checked={choice.key === 'nenhum'} onChange={() => setChoice({ key: 'nenhum' })} />
          <span className="flex-1">Sem goleiro</span>
        </label>
      </div>
      <div className="mt-2">
        <Notice>{msg}</Notice>
      </div>
      <button className="btn mt-3 w-full" disabled={busy} onClick={() => onConfirm(choice)}>
        Confirmar
      </button>
      <button className="mt-2 h-11 w-full text-sm text-muted" onClick={onClose}>
        Cancelar
      </button>
    </Sheet>
  )
}

// Emprestar: alguém de outro time (ou avulso) completa o time só neste jogo
function LendSheet({ team, lineup, profiles, guests, onClose, onConfirm }) {
  const [choice, setChoice] = useState(null)
  const [guestName, setGuestName] = useState('')
  const fieldKeys = new Set(lineup.filter((l) => l.left_minute == null).map((l) => keyOf(l.profile_id, l.guest_id)))
  const options = [
    ...profiles.filter((p) => !fieldKeys.has(keyOf(p.id))).map((p) => ({ key: keyOf(p.id), profile_id: p.id, name: p.name, sub: p.type })),
    ...guests.filter((g) => !fieldKeys.has(keyOf(null, g.id))).map((g) => ({ key: keyOf(null, g.id), name: g.name, sub: 'avulso' })),
  ]
  const ready = choice === 'novo' ? guestName.trim() : choice

  return (
    <Sheet title={`Emprestar para ${team.label}`} subtitle="Entra só neste jogo, sem tirar ninguém (lesão, time com menos gente). No próximo jogo do time dele, ele volta para o time original." onClose={onClose}>
      <div className="max-h-[40dvh] overflow-y-auto">
        {options.map((o) => (
          <label key={o.key} className="flex min-h-12 items-center gap-3 border-b border-row">
            <input type="radio" name="lend" className="h-5 w-5 accent-action" checked={choice?.key === o.key} onChange={() => setChoice(o)} />
            <span className="flex-1">{o.name}</span>
            <span className="text-xs text-muted">{o.sub}</span>
          </label>
        ))}
        <label className="flex min-h-12 items-center gap-3">
          <input type="radio" name="lend" className="h-5 w-5 accent-action" checked={choice === 'novo'} onChange={() => setChoice('novo')} />
          <span className="flex-1 text-action">+ Avulso, sem conta</span>
        </label>
      </div>
      {choice === 'novo' && <input className="field mt-2" placeholder="Nome do avulso" maxLength={40} value={guestName} onChange={(e) => setGuestName(e.target.value)} />}
      <button className="btn mt-3 w-full" disabled={!ready} onClick={() => onConfirm(choice === 'novo' ? { name: guestName.trim() } : choice)}>
        Colocar em campo
      </button>
      <button className="mt-2 h-11 w-full text-sm text-muted" onClick={onClose}>
        Cancelar
      </button>
    </Sheet>
  )
}

// Substituição parcial: quem entra pode ser mensalista, diarista, avulso ou alguém de outro time
function SubSheet({ person, name, lineup, profiles, guests, busy, onClose, onConfirm }) {
  const [choice, setChoice] = useState(null)
  const [guestName, setGuestName] = useState('')
  const fieldKeys = new Set(lineup.filter((l) => l.left_minute == null).map((l) => keyOf(l.profile_id, l.guest_id)))
  const options = [
    ...profiles.filter((p) => !fieldKeys.has(keyOf(p.id))).map((p) => ({ key: keyOf(p.id), profile_id: p.id, label: p.name, sub: p.type })),
    ...guests.filter((g) => !fieldKeys.has(keyOf(null, g.id))).map((g) => ({ key: keyOf(null, g.id), guest_id: g.id, label: g.name, sub: 'avulso' })),
  ]
  const ready = choice === 'novo' ? guestName.trim() : choice

  return (
    <Sheet title="Substituição parcial" subtitle={`Sai: ${name(person.profile_id, person.guest_id)}. Pode entrar alguém de outro time: no próximo jogo do time dele, ele volta para o time original.`} onClose={onClose}>
      <div className="mb-1 text-sm font-semibold">Entra</div>
      <div className="max-h-[40dvh] overflow-y-auto">
        {options.map((o) => (
          <label key={o.key} className="flex min-h-12 items-center gap-3 border-b border-row">
            <input type="radio" name="in" className="h-5 w-5 accent-action" checked={choice?.key === o.key} onChange={() => setChoice(o)} />
            <span className="flex-1">{o.label}</span>
            <span className="text-xs text-muted">{o.sub}</span>
          </label>
        ))}
        <label className="flex min-h-12 items-center gap-3">
          <input type="radio" name="in" className="h-5 w-5 accent-action" checked={choice === 'novo'} onChange={() => setChoice('novo')} />
          <span className="flex-1 text-action">+ Avulso, sem perfil</span>
        </label>
      </div>
      {choice === 'novo' && (
        <div className="mt-2">
          <input className="field" placeholder="Nome do avulso (sem perfil)" maxLength={40} value={guestName} onChange={(e) => setGuestName(e.target.value)} />
          <p className="mt-1 text-xs text-muted">Avulso não tem perfil: gols e assistências dele ficam só no histórico do dia.</p>
        </div>
      )}
      <button className="btn mt-3 w-full" disabled={!ready || busy} onClick={() => onConfirm(choice === 'novo' ? { newGuest: guestName.trim() } : choice)}>
        Confirmar substituição
      </button>
      <button className="mt-2 h-11 w-full text-sm text-muted" onClick={onClose}>
        Cancelar
      </button>
    </Sheet>
  )
}

// Admin edita tipo, autor, assistência e minuto
function EditEventSheet({ event, lineup, name, onClose, onSaved }) {
  const people = []
  const seen = new Set()
  for (const l of lineup) {
    const k = keyOf(l.profile_id, l.guest_id)
    if (!seen.has(k)) {
      seen.add(k)
      people.push({ ...l, key: k })
    }
  }
  const [type, setType] = useState(event.type)
  const [author, setAuthor] = useState(keyOf(event.player_id, event.player_guest_id))
  const [assist, setAssist] = useState(event.assist_id || event.assist_guest_id ? keyOf(event.assist_id, event.assist_guest_id) : '')
  const [minute, setMinute] = useState(event.minute)
  const [error, setError] = useState('')
  const authorRow = people.find((p) => p.key === author)
  const teammates = people.filter((p) => p.team_id === authorRow?.team_id && p.key !== author)

  async function save() {
    const assistRow = type === 'gol' ? teammates.find((p) => p.key === assist) : null
    const { error } = await supabase
      .from('game_events')
      .update({
        type,
        team_id: authorRow.team_id,
        minute: Number(minute),
        player_id: authorRow.profile_id ?? null,
        player_guest_id: authorRow.guest_id ?? null,
        assist_id: assistRow?.profile_id ?? null,
        assist_guest_id: assistRow?.guest_id ?? null,
      })
      .eq('id', event.id)
    if (error) setError(friendlyError(error))
    else {
      onClose()
      onSaved()
    }
  }

  return (
    <Sheet title="Editar evento" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        {['gol', 'gol_contra', 'amarelo', 'vermelho'].map((t) => (
          <button key={t} onClick={() => setType(t)} className={`h-11 rounded-lg border text-sm ${type === t ? 'border-action bg-action/15' : 'border-line-2'}`}>
            {EVENT_LABEL[t]}
          </button>
        ))}
      </div>
      <label className="label mt-3" htmlFor="author">Autor</label>
      <select id="author" className="field" value={author} onChange={(e) => setAuthor(e.target.value)}>
        {people.map((p) => (
          <option key={p.key} value={p.key}>
            {name(p.profile_id, p.guest_id)}
          </option>
        ))}
      </select>
      {type === 'gol' && (
        <>
          <label className="label mt-3" htmlFor="assist">Assistência</label>
          <select id="assist" className="field" value={assist} onChange={(e) => setAssist(e.target.value)}>
            <option value="">Sem assistência</option>
            {teammates.map((p) => (
              <option key={p.key} value={p.key}>
                {name(p.profile_id, p.guest_id)}
              </option>
            ))}
          </select>
        </>
      )}
      <label className="label mt-3" htmlFor="min">Minuto</label>
      <input id="min" className="field" type="number" min="0" max="60" value={minute} onChange={(e) => setMinute(e.target.value)} />
      <div className="mt-3">
        <Notice>{error}</Notice>
      </div>
      <button className="btn mt-3 w-full" onClick={save}>
        Salvar alteração
      </button>
      <button className="mt-2 h-11 w-full text-sm text-muted" onClick={onClose}>
        Cancelar
      </button>
    </Sheet>
  )
}
