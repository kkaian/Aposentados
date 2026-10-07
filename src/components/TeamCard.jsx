import { Check, CircleHelp } from 'lucide-react'
import { photoUrl } from '../lib/storage'
import Avatar from './Avatar'
import TeamShield from './TeamShield'

// Presença é só status: ✓ vai, ? ainda não respondeu (quem diz "não vou" sai do time e vira vaga)
function PresenceMark({ answer }) {
  if (answer === 'vou') return <Check size={13} strokeWidth={3} className="flex-none text-[#7FD3A4]" aria-label="vai" />
  return <CircleHelp size={13} className="flex-none text-gold" aria-label="dúvida" />
}

export default function TeamCard({ team, slots = 0, onMemberClick, onSlotClick, selectedId }) {
  const empty = Math.max(0, slots - team.active.length)
  return (
    <div className="rounded-xl border border-line p-2.5">
      <div className="mb-2 flex items-center gap-2">
        <TeamShield team={team} />
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{team.label}</div>
          <div className="text-xs text-muted">{team.color ? `Time ${team.color.name}` : 'sem cor'}</div>
        </div>
      </div>
      {team.active.map((m) =>
        m.is_slot ? (
          <button
            key={m.id}
            type="button"
            disabled={!onSlotClick}
            onClick={() => onSlotClick?.(m, team)}
            className="mb-0.5 flex h-7 w-full items-center gap-1.5 rounded border border-dashed border-line-2 px-1.5 text-left text-[12px] text-muted"
          >
            <span className="flex-1 truncate">{m.replacing ? `Vaga · ${m.replacing} não vai` : 'Vaga de diarista'}</span>
            {onSlotClick && <span className="font-semibold text-action">Preencher</span>}
          </button>
        ) : (
        <button
          key={m.id}
          type="button"
          disabled={!onMemberClick}
          onClick={() => onMemberClick?.(m)}
          className={`flex h-7 w-full items-center gap-1.5 rounded text-left text-[13px] ${selectedId === m.id ? 'bg-action/20' : ''}`}
        >
          <Avatar name={m.name} src={photoUrl(m.photo_path)} size={18} />
          <span className="truncate">{m.name}</span>
          {m.profile_id && <PresenceMark answer={m.answer} />}
          {m.is_captain && <span className="rounded border border-muted px-1 text-[10px] text-muted">C</span>}
          {m.type === 'avulso' && <span className="rounded border border-action px-1 text-[10px] text-action">avulso</span>}
          {m.type === 'diarista' && <span className="rounded border border-line-2 px-1 text-[10px] text-muted">diarista</span>}
        </button>
        ),
      )}
      {Array.from({ length: empty }, (_, i) => (
        <div key={i} className="flex h-7 items-center text-[13px] text-faint">
          vaga
        </div>
      ))}
    </div>
  )
}
