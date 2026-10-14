import { Copy, Crown, KeyRound, Pencil, Search } from 'lucide-react'
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
  const [access, setAccess] = useState(null)
  const [editing, setEditing] = useState(null)
  const [inactive, setInactive] = useState([])

  const load = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('id, name, username, role, type, photo_path, status').in('status', ['ativo', 'inativo'])
    const all = (data ?? []).sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name))
    setPlayers(all.filter((p) => p.status === 'ativo'))
    setInactive(all.filter((p) => p.status === 'inativo'))
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

  async function run(key, request, ok) {
    setBusy(key)
    setMsg({})
    const { error } = await request
    setBusy(null)
    if (error) return setMsg({ error: friendlyError(error) })
    setEditing(null)
    setMsg({ ok })
    load()
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
          Toque na chave para ver o usuário de alguém ou gerar uma senha temporária. Só o dono define quem é admin. Quem vira admin começa como mensalista, mas pode ser retirado da mensalidade e continuar
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
            <div className="text-xs text-muted">
              @{p.username} · {p.type}
            </div>
          </div>
          {(p.role !== 'dono' || isOwner) && (
            <>
              <button className="flex h-10 w-9 items-center justify-center text-muted" aria-label={`Editar ${p.name}`} onClick={() => setEditing({ player: p, name: p.name })}>
                <Pencil size={17} />
              </button>
              <button className="flex h-10 w-9 items-center justify-center text-muted" aria-label={`Recuperar acesso de ${p.name}`} onClick={() => setAccess({ player: p })}>
                <KeyRound size={18} />
              </button>
            </>
          )}
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

      {inactive.length > 0 && (
        <>
          <SectionLabel>Desativados · {inactive.length}</SectionLabel>
          {inactive.map((p) => (
            <div key={p.id} className="flex items-center gap-3 border-b border-row px-4 py-2">
              <Avatar name={p.name} src={photoUrl(p.photo_path)} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-muted">{p.name}</div>
                <div className="text-xs text-muted">@{p.username}</div>
              </div>
              <button
                className="btn-ghost h-9 px-3 text-sm"
                disabled={busy === p.id}
                onClick={() => run(p.id, supabase.rpc('set_player_active', { p_profile: p.id, p_active: true }), `${p.name} reativado.`)}
              >
                Reativar
              </button>
            </div>
          ))}
          <p className="px-4 pt-2 text-xs text-muted">Mensalista volta só se houver vaga na cota.</p>
        </>
      )}

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

      {access && (
        <Sheet title={`Acesso de ${access.player.name}`} subtitle="Para quem esqueceu o usuário ou a senha. Passe por fora do app (WhatsApp, pessoalmente)." onClose={() => setAccess(null)}>
          <div className="text-xs text-muted">Usuário para entrar</div>
          <div className="mb-3 font-mono text-xl font-bold select-all">{access.player.username}</div>
          {access.password ? (
            <>
              <div className="text-xs text-muted">Senha temporária</div>
              <div className="rounded-xl border border-line-2 p-4 text-center font-mono text-3xl font-bold tracking-wider select-all">{access.password}</div>
              <button
                className="btn mt-3 flex w-full items-center justify-center gap-2"
                onClick={() => navigator.clipboard?.writeText(`Usuário: ${access.player.username}
Senha temporária: ${access.password}`).then(() => setMsg({ ok: 'Copiado.' }), () => {})}
              >
                <Copy size={16} /> Copiar usuário e senha
              </button>
              <p className="mt-2 text-xs text-muted">No próximo acesso, o jogador cria a senha dele. Esta só aparece agora.</p>
            </>
          ) : (
            <button
              className="btn w-full"
              disabled={busy === 'reset'}
              onClick={async () => {
                setBusy('reset')
                const { data, error } = await supabase.rpc('admin_reset_password', { p_profile: access.player.id })
                setBusy(null)
                if (error) {
                  setAccess(null)
                  setMsg({ error: friendlyError(error) })
                } else setAccess((a) => ({ ...a, password: data }))
              }}
            >
              Gerar senha temporária
            </button>
          )}
          <button className="mt-2 h-11 w-full text-sm text-muted" onClick={() => setAccess(null)}>
            Fechar
          </button>
        </Sheet>
      )}

      {editing && (
        <Sheet title={`Editar ${editing.player.name}`} subtitle={`@${editing.player.username} · ${editing.player.type}`} onClose={() => setEditing(null)}>
          <label className="label" htmlFor="edit-name">Nome que aparece no app</label>
          <input id="edit-name" className="field" maxLength={40} value={editing.name} onChange={(e) => setEditing((x) => ({ ...x, name: e.target.value }))} />
          <button
            className="btn mt-3 w-full"
            disabled={!editing.name.trim() || editing.name.trim() === editing.player.name || busy !== null}
            onClick={() => run('rename', supabase.rpc('admin_rename', { p_profile: editing.player.id, p_name: editing.name }), 'Nome corrigido.')}
          >
            Salvar nome
          </button>
          {editing.player.role !== 'dono' && (editing.player.role !== 'admin' || isOwner) && editing.player.id !== me.id && (
            <>
              <button
                className="mt-4 h-11 w-full rounded-lg border-2 border-[#B3362B] font-semibold text-[#F29A8E]"
                disabled={busy !== null}
                onClick={() => run('off', supabase.rpc('set_player_active', { p_profile: editing.player.id, p_active: false }), `${editing.player.name} desativado.`)}
              >
                Desativar (saiu do grupo)
              </button>
              <p className="mt-1 text-xs text-muted">
                Some das listas e não entra mais no app. Os jogos e o histórico ficam, e dá para reativar depois. Mensalista desativado libera a vaga da cota e sai do pódio.
              </p>
            </>
          )}
          <button className="mt-2 h-11 w-full text-sm text-muted" onClick={() => setEditing(null)}>
            Cancelar
          </button>
        </Sheet>
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
