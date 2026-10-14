import { useState } from 'react'
import { friendlyError } from '../lib/errors'
import Sheet from './Sheet'
import { Notice } from './ui'

export const CONFIRM_WORD = 'aposentados fc'
const normalize = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ')

// Exclusão sem volta (só o dono): confirma digitando "aposentados fc", como no GitHub
export default function DangerSheet({ title, subtitle, action, onConfirm, onClose }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const ok = normalize(text) === CONFIRM_WORD

  async function confirm() {
    setBusy(true)
    setError('')
    const { error } = await onConfirm(text)
    setBusy(false)
    if (error) setError(friendlyError(error))
  }

  return (
    <Sheet title={title} subtitle={subtitle} onClose={onClose}>
      <p className="text-sm">
        Não dá para desfazer. Para confirmar, digite <b className="select-all">{CONFIRM_WORD}</b>:
      </p>
      <input
        className="field mt-2"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={CONFIRM_WORD}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <div className="mt-3">
        <Notice>{error}</Notice>
      </div>
      <button className="btn mt-3 w-full border-[#B3362B] bg-[#B3362B] disabled:opacity-40" disabled={!ok || busy} onClick={confirm}>
        {action}
      </button>
      <button className="mt-2 h-11 w-full text-sm text-muted" onClick={onClose}>
        Cancelar
      </button>
    </Sheet>
  )
}
