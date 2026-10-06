import { shieldUrl } from '../lib/storage'

// Escudo do time: imagem do kit com a cor em volta, ou um escudo na cor do time
export default function TeamShield({ team, size = 32 }) {
  const hex = team?.color?.hex ?? '#3A4A73'
  if (team?.kit) {
    return (
      <span
        className="block flex-none overflow-hidden rounded-lg border-2"
        style={{ width: size, height: size, borderColor: hex }}
      >
        <img src={shieldUrl(team.kit.shield_path)} alt={team.kit.name} className="h-full w-full scale-125 object-cover" />
      </span>
    )
  }
  return (
    <svg width={size * 0.82} height={size} viewBox="0 0 40 48" aria-hidden="true" className="flex-none">
      <path d="M20 2L37 8V24C37 35 28 43 20 46C12 43 3 35 3 24V8Z" fill={hex} stroke="#D8DEE9" strokeWidth="2" />
    </svg>
  )
}
