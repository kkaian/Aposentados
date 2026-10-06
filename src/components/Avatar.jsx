// Foto do jogador; sem foto, mostra as iniciais
export default function Avatar({ name = '', src, size = 36 }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('')

  return (
    <span
      className="flex flex-none items-center justify-center overflow-hidden rounded-full border border-line-2 bg-surface-2 font-semibold text-silver"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {src ? <img src={src} alt={name} className="h-full w-full object-cover" /> : initials}
    </span>
  )
}
