export default function Shield({ size = 40 }) {
  return (
    <span className="block flex-none overflow-hidden rounded-lg" style={{ width: size, height: size }}>
      <img src="/escudo.jpg" alt="Escudo Aposentados FC" className="block h-full w-full scale-125 object-cover" />
    </span>
  )
}
