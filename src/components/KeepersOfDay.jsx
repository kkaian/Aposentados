import { Hand } from 'lucide-react'
import { useEffect, useState } from 'react'
import { photoUrl } from '../lib/storage'
import { supabase } from '../lib/supabase'
import Avatar from './Avatar'

// Goleiros confirmados para a pelada (ficam fora dos times: o goleiro é definido em cada jogo)
export default function KeepersOfDay({ peladaId }) {
  const [keepers, setKeepers] = useState([])

  useEffect(() => {
    let alive = true
    Promise.all([
      supabase.from('profiles').select('id, name, photo_path, goalkeeper').eq('status', 'ativo').not('goalkeeper', 'is', null).order('name'),
      supabase.from('presence').select('profile_id').eq('pelada_id', peladaId).eq('answer', 'vou'),
    ]).then(([{ data: people }, { data: going }]) => {
      const ids = new Set((going ?? []).map((g) => g.profile_id))
      if (alive) setKeepers((people ?? []).filter((p) => ids.has(p.id)))
    })
    return () => {
      alive = false
    }
  }, [peladaId])

  if (!keepers.length) return null
  return (
    <div className="mx-4 mt-2 rounded-xl border border-gold/40 p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-bold">
        <Hand size={15} className="text-gold" /> Goleiros confirmados
      </div>
      {keepers.map((k) => (
        <div key={k.id} className="flex h-7 items-center gap-1.5 text-[13px]">
          <Avatar name={k.name} src={photoUrl(k.photo_path)} size={18} />
          <span className="truncate">{k.name}</span>
          {k.goalkeeper === 'tambem' && <span className="rounded border border-line-2 px-1 text-[10px] text-muted">também joga</span>}
        </div>
      ))}
    </div>
  )
}
