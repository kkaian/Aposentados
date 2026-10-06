import { AlertCircle, CheckCircle2, ChevronLeft, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function Spinner({ className = '' }) {
  return (
    <div className={`flex justify-center py-10 text-muted ${className}`}>
      <Loader2 size={28} className="animate-spin" />
    </div>
  )
}

// Mensagem de erro ou de sucesso em linha
export function Notice({ kind = 'error', children }) {
  if (!children) return null
  const ok = kind === 'ok'
  const Icon = ok ? CheckCircle2 : AlertCircle
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
        ok ? 'border-[#2E8B57]/50 bg-[#2E8B57]/10 text-[#7FD3A4]' : 'border-[#E5604F]/50 bg-[#E5604F]/10 text-[#F29A8E]'
      }`}
    >
      <Icon size={18} className="mt-px flex-none" />
      <span>{children}</span>
    </div>
  )
}

// Abas em linha (Vitórias / Gols / ..., Mês / Ano / Geral)
export function Segmented({ options, value, onChange, className = '' }) {
  return (
    <div className={`flex overflow-hidden rounded-lg border border-line text-sm ${className}`}>
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`h-10 flex-1 ${value === key ? 'bg-action font-bold text-white' : 'text-ink'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export function SectionLabel({ children, className = '' }) {
  return <div className={`px-4 pt-4 pb-2 text-xs font-semibold tracking-wide text-muted uppercase ${className}`}>{children}</div>
}

// Cabeçalho simples com voltar (telas fora do layout principal)
export function BackHeader({ title, to }) {
  const navigate = useNavigate()
  return (
    <header className="flex items-center gap-1 border-b border-line py-2 pr-4 pl-1">
      <button
        className="flex h-11 w-11 items-center justify-center rounded-lg active:bg-surface-2"
        aria-label="Voltar"
        onClick={() => (to ? navigate(to) : navigate(-1))}
      >
        <ChevronLeft size={26} />
      </button>
      <b className="text-xl">{title}</b>
    </header>
  )
}

export function Field({ label, id, icon: Icon, hint, ...props }) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        {Icon && <Icon size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />}
        <input id={id} className={`field ${Icon ? 'pl-10' : ''}`} {...props} />
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  )
}

export function AdminBadge() {
  return <span className="rounded-md border border-line-2 px-2 py-0.5 text-[11px] font-semibold text-muted">Só admin</span>
}
