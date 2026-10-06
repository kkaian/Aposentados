export default function HolderSelect({ id = 'holder', label = 'Dinheiro ficou com', holders, value, onChange }) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="field" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {holders.map((h) => (
          <option key={h.id} value={h.id}>
            {h.name} ({h.role})
          </option>
        ))}
      </select>
    </div>
  )
}
