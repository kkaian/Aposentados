import { ArrowLeftRight, Lock, Pencil, Play, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import Sheet from '../components/Sheet'
import TeamShield from '../components/TeamShield'
import { Notice, SectionLabel, Spinner } from '../components/ui'
import { isAdminRole, useAuth } from '../lib/auth'
import { friendlyError } from '../lib/errors'
import { describeEvent, EVENT_LABEL, fetchGame, GAME_GOALS, GAME_MINUTES, makeNamer, minuteOf, scoreOf } from '../lib/games'
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

function clock(game, now) {
  if (game.status === 'agendado') return `${GAME_MINUTES}:00 · ou ${GAME_GOALS} gols`
  if (game.status === 'finalizado') return 'Finalizado'
  const left = Math.max(0, GAME_MINUTES * 60 - Math.floor((now - Date.parse(game.started_at)) / 1000))
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · ou ${GAME_GOALS} gols`
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

  // fim do jogo: 10 min ou 2 gols -> tela de placar final para quem registra
  const reachedEnd = game?.status === 'ao_vivo' && (Math.max(...score) >= GAME_GOALS || minuteOf(game, now) >= GAME_MINUTES)
  const endKey = reachedEnd ? `${score.join('-')}-${minuteOf(game, now) >= GAME_MINUTES}` : null
  useEffect(() => {
    if (endKey && canManage && endShownFor.current !== endKey && !sheet) {
      endShownFor.current = endKey
      setSheet({ kind: 'fim' })
    }
  }, [endKey, canManage, sheet])

  if (data === undefined) return <Spinner />
  if (!data) return <div className="p-6 text-center text-muted">Jogo não encontrado.</div>

  const { pelada, team1, team2, lineup, events, guests, profiles, helperIds } = data
  const name = makeNamer(profiles, guests)
  const photoOf = Object.fromEntries(profiles.map((p) => [p.id, p.photo_path]))
  const penaltyTeam = [team1, team2].find((t) => t && t.id === game.penalty_winner_id)
  const canStart = game.status === 'agendado' && (isAdmin || helperIds.includes(profile.id))
  // jogo encerrado: mostra todos que jogaram (sem repetir); ao vivo: só quem está em campo
  const inField = (teamId) => {
    if (game.status !== 'finalizado') return lineup.filter((l) => l.team_id === teamId && l.left_minute == null)
    const seen = new Set()
    return lineup.filter((l) => {
      const k = keyOf(l.profile_id, l.guest_id)
      if (l.team_id !== teamId || seen.has(k)) return false
      seen.add(k)
      return true
    })
  }
  const statsOf = (l) => {
    const k = keyOf(l.profile_id, l.guest_id)
    const goals = events.filter((e) => e.type === 'gol' && keyOf(e.player_id, e.player_guest_id) === k).length
    const assists = events.filter((e) => e.type === 'gol' && (e.assist_id || e.assist_guest_id) && keyOf(e.assist_id, e.assist_guest_id) === k).length
    return `${goals}G · ${assists}A`
  }
  const minuteNow = game.status === 'ao_vivo' ? Math.min(60, minuteOf(game, now)) : (events.at(-1)?.minute ?? GAME_MINUTES)

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

  const teamColumn = (team) => (
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-1.5 text-sm font-bold">
          <TeamShield team={team} size={20} />
          <span className="truncate">{team?.label}</span>
        </div>
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
      <div className="border-b border-line px-4 pt-2 pb-3 text-center">
        <div className="text-xs text-muted">Jogo {game.number} · Pelada de hoje</div>
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
        <div className={`mt-1 text-sm tabular-nums ${reachedEnd ? 'text-gold' : 'text-muted'}`}>{clock(game, now)}</div>
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
                {e.type !== 'substituicao' && (
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
          <button className="mt-3 h-11 w-full text-sm text-muted" onClick={() => setSheet(null)}>
            Cancelar
          </button>
        </Sheet>
      )}

      {sheet?.kind === 'assist' && (
        <Sheet title="Teve assistência?" subtitle={`Gol de ${name(sheet.person.profile_id, sheet.person.guest_id)} · passo 2 de 2`} onClose={() => setSheet(null)}>
          <div className="space-y-2">
            {inField(sheet.person.team_id)
              .filter((l) => l.id !== sheet.person.id)
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
          <button className="mt-3 h-11 w-full text-sm text-muted" onClick={() => setSheet({ kind: 'acao', person: sheet.person })}>
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
              JOGO {game.number} {reachedEnd ? (Math.max(...score) >= GAME_GOALS ? 'ENCERRADO · CHEGOU A 2 GOLS' : 'ENCERRADO · 10 MINUTOS') : 'ENCERRAR'}
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
    </div>
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
