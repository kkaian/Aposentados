import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { friendlyError } from '../lib/errors'
import { useHolders } from '../lib/holders'
import { supabase } from '../lib/supabase'
import HolderSelect from './HolderSelect'
import Sheet from './Sheet'
import { Notice, Segmented } from './ui'

// Preencher "Vaga de diarista": avulso, diarista com conta ou mensalista de última hora
export default function FillSlotSheet({ slot, team, teams, onClose, onDone }) {
  const { profile } = useAuth()
  const holders = useHolders()
  const [mode, setMode] = useState('conta')
  const [people, setPeople] = useState([])
  const [pick, setPick] = useState(null)
  const [guestName, setGuestName] = useState('')
  const [paid, setPaid] = useState(false)
  const [amount, setAmount] = useState('')
  const [holder, setHolder] = useState(profile.id)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const inTeams = new Set(teams.flatMap((t) => t.active.map((m) => m.profile_id).filter(Boolean)))
    supabase
      .from('profiles')
      .select('id, name, type')
      .eq('status', 'ativo')
      .order('name')
      .then(({ data }) => setPeople((data ?? []).filter((p) => !inTeams.has(p.id))))
  }, [teams])

  const holderOk = !paid || holders.some((h) => h.id === holder)
  const ready = (mode === 'conta' ? pick : guestName.trim()) && (!paid || Number(amount) > 0) && holderOk

  async function confirm() {
    setBusy(true)
    setError('')
    const { error } = await supabase.rpc('fill_slot', {
      p_member: slot.id,
      p_profile: mode === 'conta' ? pick : null,
      p_guest_name: mode === 'avulso' ? guestName.trim() : null,
      p_paid: paid ? Number(amount) : null,
      p_holder: paid ? holder : null,
    })
    setBusy(false)
    if (error) setError(friendlyError(error))
    else onDone()
  }

  return (
    <Sheet title="Preencher vaga de diarista" subtitle={`${team.label} · quem chegou para jogar`} onClose={onClose}>
      <Segmented className="mb-2" value={mode} onChange={setMode} options={[['conta', 'Com conta'], ['avulso', 'Avulso, sem conta']]} />
      {mode === 'conta' ? (
        <div className="max-h-[32dvh] overflow-y-auto">
          {people.length === 0 && <div className="py-3 text-sm text-muted">Todo mundo com conta já está em um time.</div>}
          {people.map((p) => (
            <label key={p.id} className="flex min-h-12 items-center gap-3 border-b border-row">
              <input type="radio" name="slot-in" className="h-5 w-5 accent-action" checked={pick === p.id} onChange={() => setPick(p.id)} />
              <span className="flex-1">{p.name}</span>
              <span className="text-xs text-muted">{p.type}</span>
            </label>
          ))}
        </div>
      ) : (
        <>
          <input className="field" placeholder="Nome do avulso" maxLength={40} value={guestName} onChange={(e) => setGuestName(e.target.value)} />
          <p className="mt-1 text-xs text-muted">Avulso não tem conta: gols e assistências dele ficam só no histórico do dia.</p>
        </>
      )}

      <label className="mt-3 flex min-h-11 items-center gap-3">
        <input type="checkbox" className="h-5 w-5 accent-action" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
        Pagou para jogar
      </label>
      {paid && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="slot-paid">Quanto (R$)</label>
            <input id="slot-paid" className="field" type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <HolderSelect id="slot-holder" holders={holders} value={holderOk ? holder : ''} onChange={setHolder} label="Quem recebeu" />
        </div>
      )}

      <div className="mt-3">
        <Notice>{error}</Notice>
      </div>
      <button className="btn mt-3 w-full" disabled={!ready || busy} onClick={confirm}>
        Colocar no time
      </button>
      <button className="mt-2 h-11 w-full text-sm text-muted" onClick={onClose}>
        Cancelar
      </button>
    </Sheet>
  )
}
