import { Crown, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import Avatar from '../../components/Avatar'
import Sheet from '../../components/Sheet'
import { AdminBadge, Notice, SectionLabel, Spinner } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { friendlyError } from '../../lib/errors'
import { photoUrl } from '../../lib/storage'
import { supabase } from '../../lib/supabase'

const ROLE_ORDER = { dono: 0, admin: 1, jogador: 2 }

export default function Permissoes() {
  const { profile: me, refreshProfile } = useAuth()
  const isOwner = me.role === 'dono'
  const [players, setPlayers] = useState()
  const [query, setQuery] = useState('')
  const [msg, setMsg] = useState({})
  const [busy, setBusy] = useState(null)
  const [transferOpen, setTransferOpen] = useState(false)
  const [newOwner, setNewOwner] = useState(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('id, name, username, role, type, photo_path').eq('status', 'ativo')
    setPlayers((data ?? []).sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name)))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function setAdmin(p, admin) {
    setBusy(p.id)
    setMsg({})
    const { error } = await supabase.rpc('set_admin', { p_profile: p.id, p_admin: admin })
    setBusy(null)
    if (error) setMsg({ error: friendlyError(error) })
    else {
      setMsg({ ok: admin ? `${p.name} agora é admin (e mensalista).` : `${p.name} não é mais admin.` })
      load()
    }
  }

  async function transfer() {
    setBusy('transfer')
    const { error } = await supabase.rpc('transfer_ownership', { p_new_owner: newOwner.id })
    setBusy(null)
    setTransferOpen(false)
    if (error) setMsg({ error: friendlyError(error) })
    else {
      setMsg({ ok: `${newOwner.name} agora é o dono. Você continua como admin.` })
      await refreshProfile()
      load()
    }
  }

  if (players === undefined) return <Spinner />

  const q = query.trim().toLowerCase()
  const visible = players.filter((p) => !q || p.name.toLowerCase().includes(q) || p.username?.includes(q))
  const admins = players.filter((p) => p.role === 'admin')

  return (
    <div className="pb-6">
      <div className="flex justify-end px-4 pt-3">
        <AdminBadge />
      </div>
      <div className="px-4 pt-2">
        <div className="relative">
          <Search size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input className="field pl-10" placeholder="Buscar jogador" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <p className="mt-2 text-xs text-muted">
          Só o dono define quem é admin. Quem vira admin começa como mensalista, mas pode ser retirado da mensalidade e continuar
          admin. Ajudantes são escolhidos em cada pelada.
        </p>
      </div>

      <div className="space-y-2 px-4 pt-3">
        <Notice>{msg.error}</Notice>
        <Notice kind="ok">{msg.ok}</Notice>
      </div>

      <SectionLabel>Função no app</SectionLabel>
      {visible.map((p) => (
        <div key={p.id} className="flex items-center gap-3 border-b border-row px-4 py-2">
          <Avatar name={p.name} src={photoUrl(p.photo_path)} />
          <div className="min-w-0 flex-1">
            <div className="truncate">{p.name}</div>
            <div className="text-xs text-muted">{p.type}</div>
          </div>
          {p.role === 'dono' ? (
            <span className="flex items-center gap-1 text-sm font-semibold text-gold">
              <Crown size={16} /> Dono
            </span>
          ) : isOwner ? (
            <select
              className="h-10 rounded-lg border border-line-2 bg-surface px-2 text-sm"
              value={p.role}
              disabled={busy === p.id}
              onChange={(e) => setAdmin(p, e.target.value === 'admin')}
            >
              <option value="admin">Admin</option>
              <option value="jogador">Jogador</option>
            </select>
          ) : (
            <span className="text-sm text-muted">{p.role === 'admin' ? 'Admin' : 'Jogador'}</span>
          )}
        </div>
      ))}

      {isOwner && (
        <div className="card mx-4 mt-4">
          <b>Posse da pelada</b>
          <div className="mt-1 text-sm text-muted">Você pode passar a posse para outro admin.</div>
          <button className="btn-outline mt-3 w-full" disabled={admins.length === 0} onClick={() => setTransferOpen(true)}>
            Passar posse
          </button>
          {admins.length === 0 && <div className="mt-2 text-xs text-muted">Primeiro torne alguém admin.</div>}
        </div>
      )}

      {transferOpen && (
        <Sheet title="Passar a posse da pelada" subtitle="Escolha um admin para ser o novo dono." onClose={() => setTransferOpen(false)}>
          {admins.map((a) => (
            <label key={a.id} className="flex min-h-12 items-center gap-3 border-b border-row">
              <input type="radio" name="owner" className="h-5 w-5 accent-action" checked={newOwner?.id === a.id} onChange={() => setNewOwner(a)} />
              {a.name}
            </label>
          ))}
          <p className="my-3 text-xs text-muted">
            O novo dono passa a escolher e remover admins. Você continua como admin. Só o novo dono pode desfazer.
          </p>
          <button className="btn w-full" disabled={!newOwner || busy === 'transfer'} onClick={transfer}>
            Confirmar nova posse
          </button>
          <button className="mt-2 h-11 w-full text-sm text-muted" onClick={() => setTransferOpen(false)}>
            Cancelar
          </button>
        </Sheet>
      )}
    </div>
  )
}
