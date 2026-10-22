import { Check, Plus } from 'lucide-react'
import { photoUrl } from '../lib/storage'
import { slotSpots } from '../lib/tactics'
import Avatar from './Avatar'

const line = 'absolute border-white/55'

// Gramadinho com as 5 posições da formação; o próprio gol fica embaixo
export default function Pitch({ formation, players, highlightId, ackedIds, onSlotClick, selected }) {
  const spots = slotSpots(formation)
  return (
    <div
      className="relative mx-auto aspect-[3/4] w-full max-w-sm overflow-hidden rounded-2xl border border-[#1f5a29]"
      style={{ background: 'repeating-linear-gradient(180deg, #2f7f3b 0 12.5%, #2a7335 12.5% 25%)' }}
    >
      {/* linhas do campo */}
      <div className={`${line} inset-2 rounded-sm border-2`} />
      <div className={`${line} inset-x-2 top-1/2 border-t-2`} />
      <div className={`${line} top-1/2 left-1/2 h-[22%] w-[30%] -translate-1/2 rounded-full border-2`} />
      <div className={`${line} top-2 left-1/2 h-[13%] w-[46%] -translate-x-1/2 border-2 border-t-0`} />
      <div className={`${line} bottom-2 left-1/2 h-[13%] w-[46%] -translate-x-1/2 border-2 border-b-0`} />
      <div className={`${line} bottom-2 left-1/2 h-[5%] w-[22%] -translate-x-1/2 border-2 border-b-0`} />

      {spots.map((spot, i) => {
        const p = players[i]
        const mine = p && highlightId && p.profile_id === highlightId
        const isSelected = selected === i
        return (
          <button
            key={i}
            type="button"
            disabled={!onSlotClick}
            onClick={() => onSlotClick?.(i)}
            className="absolute flex w-[84px] -translate-1/2 flex-col items-center disabled:cursor-default"
            style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
          >
            <span className={`relative rounded-full ring-2 ${isSelected ? 'ring-gold ring-offset-2 ring-offset-[#2a7335]' : mine ? 'ring-gold' : 'ring-white/90'}`}>
              {p ? (
                <Avatar name={p.name} src={photoUrl(p.photo_path)} size={46} />
              ) : (
                <span className="flex h-[46px] w-[46px] items-center justify-center rounded-full border-2 border-dashed border-white/70 bg-white/10 text-white/80">
                  {onSlotClick ? <Plus size={20} /> : null}
                </span>
              )}
              {p && ackedIds?.has(p.profile_id) && (
                <span className="absolute -right-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#2E8B57] text-white" aria-label="entendeu">
                  <Check size={11} strokeWidth={3} />
                </span>
              )}
            </span>
            <span className="mt-1 max-w-full truncate rounded bg-black/50 px-1.5 text-[11px] leading-4 font-semibold text-white">
              {p ? p.name.split(' ')[0] : 'vazio'}
            </span>
          </button>
        )
      })}
    </div>
  )
}
