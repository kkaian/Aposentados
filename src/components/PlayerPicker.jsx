import { Check, Search } from 'lucide-react'
import { useState } from 'react'
import { photoUrl } from '../lib/storage'
import Avatar from './Avatar'
import Sheet from './Sheet'

// Escolher um jogador de uma lista (com busca)
export default function PlayerPicker({ title, subtitle, players, selectedIds = [], onPick, onClose, renderSub }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const visible = players.filter((p) => !q || p.name.toLowerCase().includes(q))

  return (
    <Sheet title={title} subtitle={subtitle} onClose={onClose}>
      {players.length > 6 && (
        <div className="relative mb-2">
          <Search size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input className="field pl-10" placeholder="Buscar" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}
      {visible.length === 0 && <div className="py-4 text-sm text-muted">Ninguém para escolher.</div>}
      {visible.map((p) => {
        const on = selectedIds.includes(p.id)
        return (
          <button key={p.id} className="flex min-h-14 w-full items-center gap-3 border-b border-row text-left" onClick={() => onPick(p)}>
            <Avatar name={p.name} src={photoUrl(p.photo_path)} />
            <div className="flex-1">
              <div>{p.name}</div>
              {renderSub && <div className="text-xs text-muted">{renderSub(p)}</div>}
            </div>
            {on && <Check size={20} className="text-action" />}
          </button>
        )
      })}
      <button className="mt-3 h-11 w-full text-sm text-muted" onClick={onClose}>
        Fechar
      </button>
    </Sheet>
  )
}
