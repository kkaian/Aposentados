import { ArrowLeftRight, CheckCircle2, Plus, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Avatar from '../components/Avatar'
import Pitch from '../components/Pitch'
import { PositionTags } from '../components/Positions'
import Sheet from '../components/Sheet'
import TeamShield from '../components/TeamShield'
import { Notice, SectionLabel, Spinner } from '../components/ui'
import { useAuth } from '../lib/auth'
import { friendlyError } from '../lib/errors'
import { fetchCurrentPelada } from '../lib/peladas'
import { photoUrl } from '../lib/storage'
import { supabase } from '../lib/supabase'
import { FORMATIONS, INSTRUCTION_MAX, MAX_INSTRUCTIONS, resolveMember, slotRole } from '../lib/tactics'
import { fetchTeams } from '../lib/teams'

const EMPTY = { formation: '2-1-2', slots: [null, null, null, null, null], instructions: [] }

// Estado da estratégia como o app usa: vagas já resolvidas para quem está no time hoje
const draftFrom = (tactic, members) =>
  tactic
    ? { formation: tactic.formation, slots: tactic.slots.map((id) => resolveMember(members, id)?.id ?? null), instructions: [...tactic.instructions] }
    : EMPTY

export default function Estrategia() {
  const { profile } = useAuth()
  const [state, setState] = useState()
  const [draft, setDraft] = useState(EMPTY)
  const [dirty, setDirty] = useState(false)
  // atualização ao vivo não apaga o que o capitão está editando
  const dirtyRef = useRef(false)
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])
  const [sheet, setSheet] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({})

  const load = useCallback(
    async (keepDraft = false) => {
      const pelada = await fetchCurrentPelada()
      if (!pelada) return setState(null)
      const teams = await fetchTeams(pelada.id)
      const team = teams.find((t) => t.captain_id === profile.id || t.active.some((m) => m.profile_id === profile.id))
      if (!team) return setState({ pelada, team: null })
      const [{ data: tactic }, { data: acks }, { data: swaps }, { data: people }] = await Promise.all([
        supabase.from('team_tactics').select('*').eq('team_id', team.id).maybeSingle(),
        supabase.from('tactic_acks').select('*').eq('team_id', team.id),
        supabase.from('tactic_swaps').select('*').eq('team_id', team.id).eq('status', 'pendente').order('created_at'),
        supabase.from('profiles').select('id, positions, goalkeeper').in('id', team.members.map((m) => m.profile_id).filter(Boolean)),
      ])
      const positionsOf = Object.fromEntries((people ?? []).map((p) => [p.id, p]))
      setState({ pelada, team, tactic, acks: acks ?? [], swaps: swaps ?? [], positionsOf })
      if (!keepDraft) {
        setDraft(draftFrom(tactic, team.members))
        setDirty(false)
      }
    },
    [profile.id],
  )

  useEffect(() => {
    load()
  }, [load])

  // ao vivo: "entendi", pedidos de troca e alterações do capitão
  const teamId = state?.team?.id
  useEffect(() => {
    if (!teamId) return
    const reload = () => load(dirtyRef.current)
    const channel = supabase
      .channel(`tactic-${teamId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_tactics', filter: `team_id=eq.${teamId}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tactic_acks', filter: `team_id=eq.${teamId}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tactic_swaps', filter: `team_id=eq.${teamId}` }, reload)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [teamId, load])

  if (state === undefined) return <Spinner />
  if (!state) return <div className="p-6 text-center text-muted">Nenhuma pelada marcada.</div>
  if (!state.team) return <div className="p-6 text-center text-sm text-muted">A estratégia é do seu time: aparece quando você estiver num time desta pelada.</div>

  const { pelada, team, tactic, acks, swaps, positionsOf } = state
  const isCaptain = team.captain_id === profile.id
  const open = ['agendada', 'em_andamento'].includes(pelada.status)
  const canEdit = isCaptain && open
  const members = team.active.filter((m) => !m.is_slot)
  const memberById = Object.fromEntries(team.members.map((m) => [m.id, m]))
  // o capitão vê o rascunho; o time vê o que está salvo
  const shown = canEdit ? draft : draftFrom(tactic, team.members)
  const players = shown.slots.map((id) => (id ? memberById[id] : null))
  const ackedIds = new Set(tactic ? acks.filter((a) => Date.parse(a.acked_at) >= Date.parse(tactic.updated_at)).map((a) => a.profile_id) : [])
  const me = members.find((m) => m.profile_id === profile.id)
  const myRequest = swaps.find((s) => s.requester_id === profile.id)
  const nameOfProfile = (pid) => members.find((m) => m.profile_id === pid)?.name ?? 'Jogador'

  const edit = (fn) => {
    setDraft((d) => fn(structuredClone(d)))
    setDirty(true)
  }

  // coloca o jogador na vaga; se ele já estava em outra, os dois trocam
  function place(index, memberId) {
    edit((d) => {
      const from = memberId == null ? -1 : d.slots.indexOf(memberId)
      if (from >= 0) d.slots[from] = d.slots[index]
      d.slots[index] = memberId
      return d
    })
    setSheet(null)
  }

  async function rpc(fn, args, ok, after) {
    setBusy(true)
    setMsg({})
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) return setMsg({ error: friendlyError(error) })
    setMsg({ ok })
    setSheet(null)
    after?.()
    load()
  }

  const save = () => rpc('save_tactic', { p_team: team.id, p_formation: draft.formation, p_slots: draft.slots, p_instructions: draft.instructions }, 'Estratégia salva. O time já vê.')

  return (
    <div className="pb-6">
      <div className="flex items-center gap-2 px-4 pt-3">
        <TeamShield team={team} size={28} />
        <div className="min-w-0">
          <div className="truncate font-bold">{team.label}</div>
          <div className="text-xs text-muted">{isCaptain ? 'Você é o capitão: só o seu time vê esta estratégia.' : `Capitão: ${team.captain?.name ?? '–'} · só o seu time vê.`}</div>
        </div>
      </div>

      {!tactic && !canEdit && (
        <div className="card mx-4 mt-3 text-sm text-muted">O capitão ainda não montou a estratégia do time.</div>
      )}

      {(tactic || canEdit) && (
        <>
          {canEdit && (
            <div className="flex gap-2 overflow-x-auto px-4 pt-3 pb-1">
              {FORMATIONS.map((f) => (
                <button
                  key={f}
                  onClick={() => edit((d) => ({ ...d, formation: f }))}
                  className={`h-9 flex-none rounded-full border px-3.5 text-sm font-semibold ${draft.formation === f ? 'border-action bg-action text-white' : 'border-line-2'}`}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
          {!canEdit && <div className="px-4 pt-3 text-center text-sm font-bold">Formação {shown.formation}</div>}

          <div className="px-4 pt-2">
            <Pitch
              formation={shown.formation}
              players={players}
              highlightId={profile.id}
              ackedIds={ackedIds}
              onSlotClick={canEdit ? (i) => setSheet({ kind: 'slot', index: i }) : undefined}
            />
            {canEdit && <p className="mt-1 text-center text-xs text-muted">Toque numa posição para pôr ou trocar o jogador.</p>}
          </div>

          <SectionLabel>Instruções do capitão</SectionLabel>
          {canEdit ? (
            <div className="space-y-2 px-4">
              {draft.instructions.map((text, i) => (
                <div key={i} className="flex items-center gap-2">
                  <b className="w-4 text-sm text-muted">{i + 1}</b>
                  <div className="relative flex-1">
                    <input
                      className="field pr-12"
                      maxLength={INSTRUCTION_MAX}
                      placeholder="Ex.: marcar a saída de bola"
                      value={text}
                      onChange={(e) => edit((d) => ((d.instructions[i] = e.target.value), d))}
                    />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[11px] text-muted">{INSTRUCTION_MAX - text.length}</span>
                  </div>
                  <button className="flex h-10 w-8 items-center justify-center text-muted" aria-label="Remover instrução" onClick={() => edit((d) => (d.instructions.splice(i, 1), d))}>
                    <X size={18} />
                  </button>
                </div>
              ))}
              {draft.instructions.length < MAX_INSTRUCTIONS && (
                <button className="flex h-10 w-full items-center justify-center gap-1 rounded-lg border border-dashed border-line-2 text-sm font-semibold text-action" onClick={() => edit((d) => (d.instructions.push(''), d))}>
                  <Plus size={16} /> Instrução ({draft.instructions.length}/{MAX_INSTRUCTIONS})
                </button>
              )}
            </div>
          ) : shown.instructions.length ? (
            <ol className="space-y-1.5 px-4">
              {shown.instructions.map((text, i) => (
                <li key={i} className="flex gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                  <b className="text-muted">{i + 1}</b> {text}
                </li>
              ))}
            </ol>
          ) : (
            <div className="px-4 text-sm text-muted">Sem instruções.</div>
          )}
        </>
      )}

      <div className="space-y-2 px-4 pt-4">
        <Notice>{msg.error}</Notice>
        <Notice kind="ok">{msg.ok}</Notice>
      </div>

      {/* capitão: salvar, apagar, pedidos de troca e quem entendeu */}
      {canEdit && (
        <div className="px-4 pt-2">
          <button className="btn w-full" disabled={busy || (!dirty && tactic)} onClick={save}>
            {tactic ? (dirty ? 'Salvar alterações' : 'Estratégia salva') : 'Salvar e mostrar ao time'}
          </button>
          {dirty && tactic && (
            <button className="mt-1 h-10 w-full text-sm text-muted" onClick={() => load()}>
              Descartar alterações
            </button>
          )}
        </div>
      )}

      {isCaptain && tactic && swaps.length > 0 && (
        <>
          <SectionLabel>Pedidos de troca</SectionLabel>
          {swaps.map((s) => (
            <div key={s.id} className="flex items-center gap-2 border-b border-row px-4 py-2">
              <ArrowLeftRight size={16} className="flex-none text-gold" />
              <div className="min-w-0 flex-1 text-sm">
                <b>{nameOfProfile(s.requester_id)}</b> quer a posição de <b>{memberById[s.target_member_id]?.name ?? 'colega'}</b>
              </div>
              <button className="btn h-9 px-3 text-sm" disabled={busy || !open} onClick={() => rpc('answer_swap', { p_id: s.id, p_accept: true }, 'Troca feita.')}>
                Aceitar
              </button>
              <button className="btn-ghost h-9 px-2 text-sm" disabled={busy || !open} onClick={() => rpc('answer_swap', { p_id: s.id, p_accept: false }, 'Pedido recusado.')}>
                Recusar
              </button>
            </div>
          ))}
          {dirty && <p className="px-4 pt-1 text-xs text-muted">Aceitar uma troca descarta as alterações não salvas.</p>}
        </>
      )}

      {isCaptain && tactic && (
        <p className="px-4 pt-3 text-xs text-muted">
          <CheckCircle2 size={13} className="mr-1 inline text-[#7FD3A4]" />
          Entenderam esta versão: {ackedIds.size} de {members.filter((m) => m.profile_id && m.profile_id !== profile.id).length}. Ao salvar uma mudança, o time confirma de novo.
        </p>
      )}

      {/* jogador: entendi e pedir troca */}
      {!isCaptain && tactic && open && me && (
        <div className="space-y-2 px-4 pt-2">
          {ackedIds.has(profile.id) ? (
            <div className="flex h-12 items-center justify-center gap-2 rounded-lg border border-[#2E8B57]/60 text-sm font-semibold text-[#7FD3A4]">
              <CheckCircle2 size={18} /> Você confirmou que entendeu
            </div>
          ) : (
            <button className="btn w-full" disabled={busy} onClick={() => rpc('ack_tactic', { p_team: team.id }, 'Confirmado. O capitão vê que você entendeu.')}>
              Entendi a estratégia
            </button>
          )}
          {myRequest ? (
            <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
              <ArrowLeftRight size={16} className="flex-none text-gold" />
              <span className="flex-1">Você pediu a posição de {memberById[myRequest.target_member_id]?.name ?? 'um colega'}. Esperando o capitão.</span>
              <button className="text-xs font-semibold text-action" disabled={busy} onClick={() => rpc('cancel_swap', { p_id: myRequest.id }, 'Pedido cancelado.')}>
                Cancelar
              </button>
            </div>
          ) : (
            <button className="btn-outline flex w-full items-center justify-center gap-2" onClick={() => setSheet({ kind: 'swap' })}>
              <ArrowLeftRight size={16} /> Pedir troca de posição
            </button>
          )}
        </div>
      )}

      {canEdit && tactic && (
        <button className="mt-4 flex h-11 w-full items-center justify-center gap-2 text-sm text-[#F29A8E]" onClick={() => setSheet({ kind: 'apagar' })}>
          <Trash2 size={16} /> Apagar estratégia
        </button>
      )}
      <p className="px-4 pt-3 text-xs text-muted">Quando a pelada é encerrada, a estratégia some: ela vale só para esta pelada.</p>

      {sheet?.kind === 'slot' && (
        <Sheet title={`Posição ${sheet.index + 1} · ${slotRole(draft.formation, sheet.index)}`} subtitle="Quem já está em outra posição troca de lugar com quem está aqui." onClose={() => setSheet(null)}>
          {members.map((m) => {
            const at = draft.slots.indexOf(m.id)
            const pos = m.profile_id ? positionsOf[m.profile_id] : null
            return (
              <button key={m.id} className="flex min-h-14 w-full items-center gap-3 border-b border-row text-left" onClick={() => place(sheet.index, m.id)}>
                <Avatar name={m.name} src={photoUrl(m.photo_path)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate">
                    {m.name}
                    {m.is_captain && <span className="ml-1 text-xs text-muted">(C)</span>}
                  </div>
                  <div className="flex flex-wrap gap-1">{pos && <PositionTags positions={pos.positions} goalkeeper={pos.goalkeeper} />}</div>
                </div>
                <span className="text-xs text-muted">{at === sheet.index ? 'aqui' : at >= 0 ? `posição ${at + 1}` : 'fora'}</span>
              </button>
            )
          })}
          <button className="mt-2 h-11 w-full text-sm text-muted" onClick={() => place(sheet.index, null)}>
            Deixar vazia
          </button>
        </Sheet>
      )}

      {sheet?.kind === 'swap' && (
        <Sheet title="Trocar de posição com quem?" subtitle="O capitão recebe o pedido e decide." onClose={() => setSheet(null)}>
          {players
            .map((p, i) => ({ p, i }))
            .filter(({ p }) => p && p.profile_id !== profile.id)
            .map(({ p, i }) => (
              <button
                key={p.id}
                className="flex min-h-14 w-full items-center gap-3 border-b border-row text-left"
                disabled={busy}
                onClick={() => rpc('request_swap', { p_team: team.id, p_target: p.id }, 'Pedido enviado ao capitão.')}
              >
                <Avatar name={p.name} src={photoUrl(p.photo_path)} />
                <span className="flex-1">{p.name}</span>
                <span className="text-xs text-muted">{slotRole(shown.formation, i)}</span>
              </button>
            ))}
          <button className="mt-2 h-11 w-full text-sm text-muted" onClick={() => setSheet(null)}>
            Cancelar
          </button>
        </Sheet>
      )}

      {sheet?.kind === 'apagar' && (
        <Sheet title="Apagar a estratégia?" subtitle="Some para o time todo. Você pode montar outra depois." onClose={() => setSheet(null)}>
          <button className="btn w-full border-[#B3362B] bg-[#B3362B]" disabled={busy} onClick={() => rpc('delete_tactic', { p_team: team.id }, 'Estratégia apagada.')}>
            Apagar
          </button>
          <button className="mt-2 h-11 w-full text-sm text-muted" onClick={() => setSheet(null)}>
            Cancelar
          </button>
        </Sheet>
      )}
    </div>
  )
}
