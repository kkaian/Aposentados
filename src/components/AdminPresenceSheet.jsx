import { useState } from 'react'
import { friendlyError } from '../lib/errors'
import { supabase } from '../lib/supabase'
import Sheet from './Sheet'
import { Notice } from './ui'

const LABEL = { vou: 'vai', nao_vou: 'não vai' }

// Admin marca a presença por outra pessoa (ex.: faltou sem avisar).
// "Não vai" de quem está num time vira vaga de diarista, igual a quando o próprio jogador responde.
export default function AdminPresenceSheet({ pelada, person, answer, inTeam, onClose, onDone }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function mark(value) {
    setBusy(true)
    setError('')
    const { error } = value
      ? await supabase
          .from('presence')
          .upsert({ pelada_id: pelada.id, profile_id: person.id, answer: value, answered_at: new Date().toISOString() })
      : await supabase.from('presence').delete().eq('pelada_id', pelada.id).eq('profile_id', person.id)
    setBusy(false)
    if (error) setError(friendlyError(error))
    else onDone()
  }

  return (
    <Sheet
      title={person.name}
      subtitle={`Hoje: ${LABEL[answer] ?? 'dúvida (não respondeu)'}. Marcando pelo admin.`}
      onClose={onClose}
    >
      {inTeam && answer !== 'nao_vou' && (
        <p className="mb-3 text-sm text-muted">Está num time: marcar "Não vai" tira ele do time e deixa uma vaga de diarista para preencher.</p>
      )}
      <div className="flex gap-2">
        <button className="btn flex-1" disabled={busy || answer === 'vou'} onClick={() => mark('vou')}>
          Vai
        </button>
        <button
          className="h-11 flex-1 rounded-lg border-2 border-[#B3362B] font-semibold text-[#F29A8E] disabled:opacity-40"
          disabled={busy || answer === 'nao_vou'}
          onClick={() => mark('nao_vou')}
        >
          Não vai
        </button>
      </div>
      {answer === 'vou' && (
        <button className="mt-2 h-11 w-full text-sm text-muted" disabled={busy} onClick={() => mark(null)}>
          Voltar para dúvida
        </button>
      )}
      <div className="mt-2">
        <Notice>{error}</Notice>
      </div>
      <button className="mt-1 h-11 w-full text-sm text-muted" onClick={onClose}>
        Cancelar
      </button>
    </Sheet>
  )
}
