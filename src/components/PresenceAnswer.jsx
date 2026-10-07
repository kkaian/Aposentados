import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { friendlyError } from '../lib/errors'
import { supabase } from '../lib/supabase'
import Sheet from './Sheet'
import { Notice } from './ui'

// Vou / Não vou. A presença é só um status: os times não dependem dela.
// "Vou" só com a lista aberta; "Não vou" (desfazer a ida) até a pelada acabar.
export default function PresenceAnswer({ pelada, mine, onDone, className = '' }) {
  const { profile } = useAuth()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [undo, setUndo] = useState(null)

  const canGo = pelada.presence_open && pelada.status === 'agendada'
  const canSkip = pelada.status === 'agendada' || pelada.status === 'em_andamento'

  async function answer(value) {
    if (mine?.answer === value) return
    setBusy(true)
    setError('')
    const { error } = await supabase
      .from('presence')
      .upsert({ pelada_id: pelada.id, profile_id: profile.id, answer: value, answered_at: new Date().toISOString() })
    setBusy(false)
    setUndo(null)
    if (error) setError(/row-level/.test(error.message) ? 'A presença é para mensalistas e diaristas chamados pelo admin.' : friendlyError(error))
    else onDone?.()
  }

  // desfazer a ida: avisa se a pessoa já está num time (a vaga vira vaga de diarista)
  async function skip() {
    if (mine?.answer !== 'vou') return answer('nao_vou')
    const { data } = await supabase
      .from('team_members')
      .select('id')
      .eq('pelada_id', pelada.id)
      .eq('profile_id', profile.id)
      .eq('is_out', false)
    setUndo({ inTeam: (data ?? []).length > 0 })
  }

  const status = mine?.waitlisted
    ? 'Você está na lista de espera'
    : mine?.answer === 'vou'
      ? 'Você vai'
      : mine?.answer === 'nao_vou'
        ? 'Você não vai'
        : 'Você ainda não respondeu (dúvida)'

  return (
    <div className={className}>
      <div className="flex gap-2">
        <button
          className={`h-11 flex-1 rounded-lg border-2 border-action font-semibold disabled:opacity-40 ${mine?.answer === 'vou' ? 'bg-action text-white' : 'text-action'}`}
          disabled={busy || !canGo}
          onClick={() => answer('vou')}
        >
          Vou
        </button>
        <button
          className={`h-11 flex-1 rounded-lg border-2 border-line-2 font-semibold disabled:opacity-40 ${mine?.answer === 'nao_vou' ? 'bg-surface-2 text-ink' : 'text-muted'}`}
          disabled={busy || !canSkip}
          onClick={skip}
        >
          Não vou
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted">
        <span className="flex-1">
          {status}
          {!canGo && canSkip && ' · lista fechada'}
        </span>
        {mine?.answer === 'vou' && canSkip && (
          <button className="font-semibold text-action" disabled={busy} onClick={skip}>
            Desfazer ida
          </button>
        )}
      </div>
      {error && (
        <div className="mt-2">
          <Notice>{error}</Notice>
        </div>
      )}

      {undo && (
        <Sheet
          title="Desfazer a ida?"
          subtitle={
            undo.inTeam
              ? 'Você sai do seu time e fica uma vaga de diarista no lugar. Os admins são avisados para colocar alguém.'
              : 'Você passa para "Não vou".'
          }
          onClose={() => setUndo(null)}
        >
          {!canGo && <p className="mb-3 text-sm text-muted">A lista já fechou: para voltar a ir, só um admin consegue te colocar de novo.</p>}
          <button className="btn w-full" disabled={busy} onClick={() => answer('nao_vou')}>
            Não vou mais
          </button>
          <button className="mt-2 h-11 w-full text-sm text-muted" onClick={() => setUndo(null)}>
            Cancelar
          </button>
        </Sheet>
      )}
    </div>
  )
}
