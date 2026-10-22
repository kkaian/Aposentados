import { useState } from 'react'
import { FUNCTIONS, GOALKEEPER_LABEL, groupPositions } from '../lib/positions'
import Sheet from './Sheet'
import { Notice } from './ui'

// Funções em etiquetas: compactas nas listas (ATA · Ponta), por extenso no perfil; goleiro primeiro
export function PositionTags({ positions, goalkeeper, full = false }) {
  const size = full ? 'text-xs' : 'text-[10px]'
  return (
    <>
      {goalkeeper && (
        <span className={`rounded-md border border-gold/70 px-1.5 py-px whitespace-nowrap text-gold ${size}`}>
          {full ? GOALKEEPER_LABEL[goalkeeper] : 'GOL'}
        </span>
      )}
      {groupPositions(positions).map(({ fn, traits }) => (
        <span key={fn.key} className={`rounded-md border px-1.5 py-px whitespace-nowrap ${fn.tone} ${size}`}>
          {full ? fn.label : fn.short} · {traits.join('/')}
        </span>
      ))}
    </>
  )
}

// Escolher as próprias funções: uma ou mais, cada uma com uma ou as duas características
export function PositionsSheet({ value = [], onSave, onClose }) {
  const [picked, setPicked] = useState(value)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toggle = (code) => setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]))

  async function save() {
    setBusy(true)
    setError('')
    try {
      await onSave(picked)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Sheet title="Minhas funções" subtitle="Marque onde você joga. Pode marcar mais de uma." onClose={onClose}>
      {FUNCTIONS.map((fn) => (
        <div key={fn.key} className="border-b border-row py-3">
          <div className="text-sm font-semibold">{fn.label}</div>
          <div className="mt-2 flex gap-2">
            {fn.traits.map(([t, label]) => {
              const code = `${fn.key}_${t}`
              const on = picked.includes(code)
              return (
                <button
                  key={code}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(code)}
                  className={`h-10 flex-1 rounded-lg border text-sm ${on ? 'border-action bg-action font-semibold text-white' : 'border-line-2 text-ink'}`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <div className="mt-3 space-y-2">
        <Notice>{error}</Notice>
        <button className="btn w-full" disabled={busy} onClick={save}>
          Salvar
        </button>
        <button className="h-11 w-full text-sm text-muted" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </Sheet>
  )
}
