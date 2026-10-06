import { ChevronRight, Crown, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { Spinner } from '../components/ui'
import { useAuth } from '../lib/auth'
import { photoUrl } from '../lib/storage'
import { supabase } from '../lib/supabase'

const FILTERS = [
  ['todos', 'Todos'],
  ['mensalista', 'Mensalistas'],
  ['diarista', 'Diaristas'],
  ['admin', 'Admins'],
]

const ROLE_ORDER = { dono: 0, admin: 1, jogador: 2 }

function OverallStars({ value }) {
  const pct = value ? (Number(value) / 5) * 100 : 0
  return (
    <span className="relative inline-block text-xs leading-none tracking-[2px] text-line">
      ★★★★★
      <i className="absolute top-0 left-0 overflow-hidden whitespace-nowrap text-silver not-italic" style={{ width: `${pct}%` }}>
        ★★★★★
      </i>
    </span>
  )
}

export default function Jogadores() {
  const { profile: me } = useAuth()
  const [players, setPlayers] = useState()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('todos')

  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('id, name, username, role, type, photo_path').eq('status', 'ativo'),
      supabase.from('rating_summary').select('profile_id, overall'),
    ]).then(([{ data: people }, { data: ratings }]) => {
      const overall = Object.fromEntries((ratings ?? []).map((r) => [r.profile_id, r.overall]))
      setPlayers(
        (people ?? [])
          .map((p) => ({ ...p, overall: overall[p.id] }))
          .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || (a.type === b.type ? 0 : a.type === 'mensalista' ? -1 : 1) || a.name.localeCompare(b.name)),
      )
    })
  }, [])

  if (!players) return <Spinner />

  const q = query.trim().toLowerCase()
  const count = (key) => players.filter((p) => (key === 'todos' ? true : key === 'admin' ? p.role !== 'jogador' : p.type === key)).length
  const visible = players.filter(
    (p) =>
      (filter === 'todos' || (filter === 'admin' ? p.role !== 'jogador' : p.type === filter)) &&
      (!q || p.name.toLowerCase().includes(q) || p.username?.includes(q)),
  )

  return (
    <div className="pb-6">
      <div className="px-4 pt-3">
        <div className="relative">
          <Search size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input className="field pl-10" placeholder="Buscar jogador" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto px-4 pt-3 pb-1">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`h-9 flex-none rounded-full border px-3.5 text-sm ${filter === key ? 'border-action bg-action text-white' : 'border-line-2 text-ink'}`}
          >
            {label} {count(key)}
          </button>
        ))}
      </div>

      <div className="pt-2">
        {visible.length === 0 && <div className="px-4 py-6 text-center text-sm text-muted">Ninguém encontrado.</div>}
        {visible.map((p) => (
          <Link key={p.id} to={p.id === me.id ? '/perfil' : `/jogador/${p.id}`} className="flex min-h-16 items-center gap-3 border-b border-row px-4 active:bg-surface-2">
            <Avatar name={p.name} src={photoUrl(p.photo_path)} size={44} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-semibold">{p.name}</span>
                {p.id === me.id && <span className="text-xs text-muted">(você)</span>}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                {p.role === 'dono' && (
                  <span className="flex items-center gap-0.5 rounded-md border border-gold px-1.5 py-px font-semibold text-gold">
                    <Crown size={11} /> Dono
                  </span>
                )}
                {p.role === 'admin' && <span className="rounded-md border border-action px-1.5 py-px font-semibold text-action">Admin</span>}
                <span className={`rounded-md px-1.5 py-px ${p.type === 'mensalista' ? 'bg-surface-2 text-silver' : 'border border-line-2 text-muted'}`}>
                  {p.type === 'mensalista' ? 'Mensalista' : 'Diarista'}
                </span>
                {p.overall != null && <OverallStars value={p.overall} />}
              </div>
            </div>
            <ChevronRight size={18} className="text-muted" />
          </Link>
        ))}
      </div>
    </div>
  )
}
