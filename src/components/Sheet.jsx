// Painel que sobe de baixo (confirmações e escolhas); o app não usa confirm() do navegador
export default function Sheet({ title, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-[rgba(4,7,16,.78)]" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 mx-auto max-h-[85dvh] max-w-md overflow-y-auto rounded-t-2xl border-t border-line-2 bg-surface px-4 pt-3 pb-[calc(20px+env(safe-area-inset-bottom))]">
        <div className="mx-auto mb-3 h-1 w-10 rounded bg-line-2" />
        {title && <div className="text-xl font-bold">{title}</div>}
        {subtitle && <div className="mt-1 mb-3 text-sm text-muted">{subtitle}</div>}
        {children}
      </div>
    </div>
  )
}
