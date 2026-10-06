import { Construction } from 'lucide-react'

// Tela provisória enquanto a rota não é implementada
export default function EmBreve({ titulo }) {
  return (
    <div className="flex flex-col items-center px-8 pt-20 text-center">
      <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-surface text-muted">
        <Construction size={30} />
      </span>
      <b className="text-lg">{titulo}</b>
      <p className="mt-1 text-sm text-muted">Esta tela ainda está em construção.</p>
    </div>
  )
}
