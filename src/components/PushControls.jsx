import { Bell, BellOff, X } from 'lucide-react'
import { useState } from 'react'
import { friendlyError } from '../lib/errors'
import { usePush } from '../lib/push'

const DISMISS_KEY = 'push-card-dismissed'

function useAction(fn) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run() {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(friendlyError(e))
    }
    setBusy(false)
  }
  return { busy, error, run }
}

// Convite na tela de Início para quem ainda não ativou (some ao fechar)
export function PushCard() {
  const { status, enable } = usePush()
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })
  const action = useAction(enable)
  if (status !== 'off' || hidden) return null

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // sem armazenamento: só esconde agora
    }
    setHidden(true)
  }

  return (
    <div className="card mx-4 mt-3 flex items-start gap-3">
      <Bell size={20} className="mt-0.5 flex-none text-action" />
      <div className="flex-1">
        <div className="font-semibold">Ative as notificações</div>
        <div className="text-xs text-muted">Sua vez de escolher, pelada marcada, times fechados e pagamentos.</div>
        {action.error && <div className="mt-1 text-xs text-[#F29A8E]">{action.error}</div>}
        <button className="btn mt-2 h-10 px-4 text-sm" disabled={action.busy} onClick={action.run}>
          Ativar
        </button>
      </div>
      <button className="p-1 text-muted" aria-label="Fechar" onClick={dismiss}>
        <X size={18} />
      </button>
    </div>
  )
}

// Ajuste no próprio perfil
export function PushSetting() {
  const { status, enable, disable } = usePush()
  const on = useAction(enable)
  const off = useAction(disable)
  const error = on.error || off.error

  const text = {
    loading: '…',
    unsupported: 'Este navegador não recebe notificações.',
    install: 'No iPhone, instale o app na tela de início (menu → Instalar app) e abra por lá para ativar.',
    denied: 'Notificações bloqueadas. Libere nas configurações do celular para este site.',
    off: 'Desativadas neste aparelho.',
    on: 'Ativadas neste aparelho.',
  }[status]

  return (
    <div className="card mt-2 flex items-center gap-3">
      {status === 'on' ? <Bell size={20} className="flex-none text-action" /> : <BellOff size={20} className="flex-none text-muted" />}
      <div className="flex-1">
        <div className="text-sm font-semibold">Notificações</div>
        <div className="text-xs text-muted">{text}</div>
        {error && <div className="mt-1 text-xs text-[#F29A8E]">{error}</div>}
      </div>
      {status === 'off' && (
        <button className="btn h-9 px-3 text-sm" disabled={on.busy} onClick={on.run}>
          Ativar
        </button>
      )}
      {status === 'on' && (
        <button className="btn-ghost h-9 px-3 text-sm" disabled={off.busy} onClick={off.run}>
          Desativar
        </button>
      )}
    </div>
  )
}
