import { useEffect, useState } from 'react'
import { friendlyError } from '../lib/errors'
import { supabase } from '../lib/supabase'
import Sheet from './Sheet'
import TeamShield from './TeamShield'
import { Notice, Segmented } from './ui'

const PRESENCE_LABEL = { vou: 'vai', nao_vou: 'não vai' }

// Quem entra: alguém com conta (fora dos times desta pelada) ou avulso pelo nome
function PersonChoice({ teams, value, onChange }) {
  const [people, setPeople] = useState([])

  useEffect(() => {
    // quem já está (ou esteve) num time desta pelada não aparece
    const inTeams = new Set(teams.flatMap((t) => t.members.map((m) => m.profile_id).filter(Boolean)))
    supabase
      .from('profiles')
      .select('id, name, type')
      .eq('status', 'ativo')
      .order('name')
      .then(({ data }) => setPeople((data ?? []).filter((p) => !inTeams.has(p.id))))
  }, [teams])

  return (
    <>
      <Segmented className="mb-2" value={value.mode} onChange={(mode) => onChange({ ...value, mode })} options={[['conta', 'Com conta'], ['avulso', 'Avulso, sem conta']]} />
      {value.mode === 'conta' ? (
        <div className="max-h-[32dvh] overflow-y-auto">
          {people.length === 0 && <div className="py-3 text-sm text-muted">Todo mundo com conta já está em um time.</div>}
          {people.map((p) => (
            <label key={p.id} className="flex min-h-12 items-center gap-3 border-b border-row">
              <input type="radio" name="person-in" className="h-5 w-5 accent-action" checked={value.profile === p.id} onChange={() => onChange({ ...value, profile: p.id })} />
              <span className="flex-1">{p.name}</span>
              <span className="text-xs text-muted">{p.type}</span>
            </label>
          ))}
        </div>
      ) : (
        <input className="field" placeholder="Nome do avulso" maxLength={40} value={value.guest} onChange={(e) => onChange({ ...value, guest: e.target.value })} />
      )}
    </>
  )
}

const emptyChoice = { mode: 'conta', profile: null, guest: '' }
const choiceReady = (c) => (c.mode === 'conta' ? c.profile : c.guest.trim())
const choiceArgs = (c) => ({ p_profile: c.mode === 'conta' ? c.profile : null, p_guest_name: c.mode === 'avulso' ? c.guest.trim() : null })

function useRun(onDone) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function run(request) {
    setBusy(true)
    setError('')
    const { error } = await request
    setBusy(false)
    if (error) setError(friendlyError(error))
    else onDone()
  }
  return { error, busy, run }
}

const Item = ({ children, danger, ...props }) => (
  <button className={`flex min-h-12 w-full items-center border-b border-row text-left ${danger ? 'text-[#F29A8E]' : ''}`} {...props}>
    {children}
  </button>
)

// Admin toca num jogador do time: presença, trocar, mover, tirar, corrigir nome, faltou
export function MemberSheet({ pelada, team, member, teams, hasGames, editable, onClose, onDone }) {
  const [view, setView] = useState('menu')
  const [choice, setChoice] = useState(emptyChoice)
  const [name, setName] = useState(member.name)
  const { error, busy, run } = useRun(onDone)
  const closed = pelada.status === 'encerrada'
  const isGuest = !member.profile_id
  const canEdit = editable && !member.is_captain

  function presence(value) {
    return run(
      value
        ? supabase.from('presence').upsert({ pelada_id: pelada.id, profile_id: member.profile_id, answer: value, answered_at: new Date().toISOString() })
        : supabase.from('presence').delete().eq('pelada_id', pelada.id).eq('profile_id', member.profile_id),
    )
  }

  const back = (
    <button className="mt-2 h-11 w-full text-sm text-muted" onClick={() => setView('menu')}>
      Voltar
    </button>
  )

  return (
    <Sheet
      title={member.name}
      subtitle={`${team.label}${member.is_captain ? ' · capitão' : ''}${isGuest ? ' · avulso' : !closed ? ` · hoje: ${PRESENCE_LABEL[member.answer] ?? 'dúvida'}` : ''}`}
      onClose={onClose}
    >
      {view === 'menu' && (
        <>
          {!isGuest && !closed && (
            <>
              <div className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Presença (pelo admin)</div>
              <div className="flex gap-2">
                <button className="btn flex-1" disabled={busy || member.answer === 'vou'} onClick={() => presence('vou')}>
                  Vai
                </button>
                <button
                  className="h-11 flex-1 rounded-lg border-2 border-[#B3362B] font-semibold text-[#F29A8E] disabled:opacity-40"
                  disabled={busy || member.answer === 'nao_vou'}
                  onClick={() => presence('nao_vou')}
                >
                  Não vai
                </button>
              </div>
              <p className="mt-1 mb-3 text-xs text-muted">"Não vai" tira do time e deixa uma vaga de diarista no lugar.</p>
            </>
          )}
          <div className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Corrigir</div>
          {canEdit && (
            <>
              <Item onClick={() => setView('swap')}>Trocar por outra pessoa</Item>
              {teams.length > 1 && <Item onClick={() => setView('move')}>Mudar de time</Item>}
              <Item onClick={() => setView('vacate')}>Tirar do time (vira vaga)</Item>
            </>
          )}
          {isGuest && <Item onClick={() => setView('rename')}>Corrigir o nome do avulso</Item>}
          {hasGames && (
            <Item danger onClick={() => setView('absent')}>
              Faltou: tirar de todos os jogos
            </Item>
          )}
          {member.is_captain && <p className="pt-2 text-xs text-muted">Capitão não sai nem muda de time: use "Trocar capitão" em Times da pelada.</p>}
          {!editable && <p className="pt-2 text-xs text-muted">Durante a escolha dos times não dá para mexer nos times (só desfazer a última escolha).</p>}
          <div className="mt-2">
            <Notice>{error}</Notice>
          </div>
          <button className="mt-2 h-11 w-full text-sm text-muted" onClick={onClose}>
            Fechar
          </button>
        </>
      )}

      {view === 'swap' && (
        <>
          <p className="mb-2 text-sm text-muted">Quem fica no lugar de {member.name} neste time (ex.: a vaga foi preenchida com a pessoa errada).</p>
          <PersonChoice teams={teams} value={choice} onChange={setChoice} />
          <div className="mt-3">
            <Notice>{error}</Notice>
          </div>
          <button className="btn mt-3 w-full" disabled={!choiceReady(choice) || busy} onClick={() => run(supabase.rpc('swap_member', { p_member: member.id, ...choiceArgs(choice) }))}>
            Trocar
          </button>
          <p className="mt-1 text-xs text-muted">Se ele tinha pago para jogar, estorne no Caixa.</p>
          {back}
        </>
      )}

      {view === 'move' && (
        <>
          <p className="mb-2 text-sm text-muted">Para qual time {member.name} vai?</p>
          <div className="grid grid-cols-2 gap-2">
            {teams
              .filter((t) => t.id !== team.id)
              .map((t) => (
                <button
                  key={t.id}
                  disabled={busy}
                  onClick={() => run(supabase.rpc('move_member', { p_member: member.id, p_team: t.id }))}
                  className="flex h-12 items-center gap-2 rounded-lg border border-line-2 px-2 text-left text-sm"
                >
                  <TeamShield team={t} size={24} />
                  <span className="truncate">{t.label}</span>
                </button>
              ))}
          </div>
          <div className="mt-3">
            <Notice>{error}</Notice>
          </div>
          {back}
        </>
      )}

      {view === 'vacate' && (
        <>
          <p className="text-sm text-muted">{member.name} sai do time e fica uma vaga de diarista no lugar. Os jogos que ele já jogou continuam valendo; se ele não jogou, use "Faltou".</p>
          <div className="mt-3">
            <Notice>{error}</Notice>
          </div>
          <button className="btn mt-3 w-full" disabled={busy} onClick={() => run(supabase.rpc('vacate_member', { p_member: member.id }))}>
            Tirar do time
          </button>
          {back}
        </>
      )}

      {view === 'rename' && (
        <>
          <input className="field" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          <div className="mt-3">
            <Notice>{error}</Notice>
          </div>
          <button
            className="btn mt-3 w-full"
            disabled={!name.trim() || busy}
            onClick={() => run(supabase.from('guests').update({ name: name.trim() }).eq('id', member.guest_id))}
          >
            Salvar nome
          </button>
          {back}
        </>
      )}

      {view === 'absent' && (
        <>
          <p className="text-sm">
            {member.name} sai de <b>todos os jogos</b> desta pelada e do time: não conta jogo, vitória nem Seleção do mês. Quem entrou no lugar dele continua valendo.
          </p>
          <p className="mt-2 text-xs text-muted">
            {closed ? 'Pelada encerrada: ele só sai, sem abrir vaga.' : 'Fica uma vaga de diarista no lugar dele.'} Se ele tiver gol, assistência ou cartão, exclua esses eventos antes.
          </p>
          <div className="mt-3">
            <Notice>{error}</Notice>
          </div>
          <button
            className="btn mt-3 w-full border-[#B3362B] bg-[#B3362B]"
            disabled={busy}
            onClick={() => run(supabase.rpc('mark_absent', { p_pelada: pelada.id, p_profile: member.profile_id ?? null, p_guest: member.guest_id ?? null }))}
          >
            Marcar que faltou
          </button>
          {back}
        </>
      )}
    </Sheet>
  )
}

// Admin coloca alguém no time ou cria uma vaga vazia
export function AddMemberSheet({ team, teams, onClose, onDone }) {
  const [choice, setChoice] = useState(emptyChoice)
  const { error, busy, run } = useRun(onDone)
  return (
    <Sheet title={`Adicionar ao ${team.label}`} subtitle="Para corrigir o time (ex.: alguém jogou e não estava na lista)." onClose={onClose}>
      <PersonChoice teams={teams} value={choice} onChange={setChoice} />
      <div className="mt-3">
        <Notice>{error}</Notice>
      </div>
      <button className="btn mt-3 w-full" disabled={!choiceReady(choice) || busy} onClick={() => run(supabase.rpc('add_member', { p_team: team.id, ...choiceArgs(choice) }))}>
        Colocar no time
      </button>
      <button className="btn-ghost mt-2 w-full" disabled={busy} onClick={() => run(supabase.rpc('add_slot', { p_team: team.id }))}>
        Criar vaga vazia
      </button>
      <button className="mt-2 h-11 w-full text-sm text-muted" onClick={onClose}>
        Cancelar
      </button>
    </Sheet>
  )
}

// Quem saiu do time (disse "não vou", faltou ou foi substituído): admin desfaz a saída
export function RestoreSheet({ team, member, onClose, onDone }) {
  const { error, busy, run } = useRun(onDone)
  return (
    <Sheet
      title={`${member.name} volta para o time?`}
      subtitle={`${team.label}. Quem entrou no lugar dele (vaga, diarista ou avulso) sai, e ele volta a constar como "vai".`}
      onClose={onClose}
    >
      <Notice>{error}</Notice>
      <button className="btn mt-3 w-full" disabled={busy} onClick={() => run(supabase.rpc('restore_member', { p_member: member.id }))}>
        Desfazer saída
      </button>
      <p className="mt-1 text-xs text-muted">Jogos já jogados não mudam. Se quem entrou tinha pago para jogar, estorne no Caixa.</p>
      <button className="mt-2 h-11 w-full text-sm text-muted" onClick={onClose}>
        Cancelar
      </button>
    </Sheet>
  )
}
