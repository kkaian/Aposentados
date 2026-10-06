import { Copy, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import Avatar from '../../components/Avatar'
import Sheet from '../../components/Sheet'
import { AdminBadge, Notice, SectionLabel, Spinner } from '../../components/ui'
import { friendlyError } from '../../lib/errors'
import { supabase } from '../../lib/supabase'

export default function Cadastros() {
  const [invite, setInvite] = useState()
  const [pending, setPending] = useState()
  const [requests, setRequests] = useState([])
  const [confirmNew, setConfirmNew] = useState(false)
  const [msg, setMsg] = useState({})
  const [busy, setBusy] = useState(null)
  const [temp, setTemp] = useState(null)

  const load = useCallback(async () => {
    const [inv, pend, reqs] = await Promise.all([
      supabase.from('invites').select('code').eq('active', true).maybeSingle(),
      supabase.from('profiles').select('id, name, username, created_at').eq('status', 'pendente').order('created_at'),
      supabase.from('password_requests').select('id, created_at, profile:profiles!password_requests_profile_id_fkey(id, name, username)').is('resolved_at', null),
    ])
    setInvite(inv.data?.code ?? null)
    setPending(pend.data ?? [])
    setRequests(reqs.data ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function run(key, fn, okText) {
    setBusy(key)
    setMsg({})
    const { error } = await fn()
    setBusy(null)
    if (error) setMsg({ error: friendlyError(error) })
    else {
      if (okText) setMsg({ ok: okText })
      load()
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(invite)
      setMsg({ ok: 'Código copiado.' })
    } catch {
      setMsg({ error: 'Não deu para copiar. Selecione o código e copie à mão.' })
    }
  }

  if (pending === undefined) return <Spinner />

  return (
    <div className="pb-6">
      <div className="flex justify-end px-4 pt-3">
        <AdminBadge />
      </div>

      <SectionLabel className="pt-1">Código de convite</SectionLabel>
      <div className="card mx-4">
        {invite ? (
          <div className="font-mono text-2xl font-bold tracking-[0.2em] select-all">{invite}</div>
        ) : (
          <div className="text-sm text-muted">Nenhum código ativo. Gere um para liberar cadastros.</div>
        )}
        <div className="mt-3 flex gap-2">
          {invite && (
            <button className="btn-outline flex flex-1 items-center justify-center gap-2" onClick={copy}>
              <Copy size={16} /> Copiar
            </button>
          )}
          <button
            className="btn-ghost flex flex-1 items-center justify-center gap-2"
            disabled={busy === 'invite'}
            onClick={() => (invite ? setConfirmNew(true) : run('invite', () => supabase.rpc('generate_invite')))}
          >
            <RefreshCw size={16} /> Gerar novo
          </button>
        </div>
        <div className="mt-2 text-xs text-muted">Gerar um novo invalida o código anterior.</div>
      </div>

      <div className="px-4 pt-3">
        <Notice>{msg.error}</Notice>
        <Notice kind="ok">{msg.ok}</Notice>
      </div>

      <SectionLabel>Aprovar cadastros · {String(pending.length).padStart(2, '0')} · entram como diarista</SectionLabel>
      {pending.length === 0 && <div className="px-4 text-sm text-muted">Nenhum cadastro aguardando.</div>}
      {pending.map((p) => (
        <div key={p.id} className="flex items-center gap-3 border-b border-row px-4 py-2">
          <Avatar name={p.name} />
          <div className="min-w-0 flex-1">
            <div className="truncate">{p.name}</div>
            <div className="text-xs text-muted">@{p.username}</div>
          </div>
          <button
            className="btn h-9 px-3 text-sm"
            disabled={busy === p.id}
            onClick={() => run(p.id, () => supabase.rpc('review_signup', { p_profile: p.id, p_approve: true }), `${p.name} aprovado.`)}
          >
            Aprovar
          </button>
          <button
            className="btn-ghost h-9 px-3 text-sm"
            disabled={busy === p.id}
            onClick={() => run(p.id, () => supabase.rpc('review_signup', { p_profile: p.id, p_approve: false }))}
          >
            Recusar
          </button>
        </div>
      ))}

      <SectionLabel>Pedidos de nova senha · {String(requests.length).padStart(2, '0')}</SectionLabel>
      {requests.length === 0 && <div className="px-4 text-sm text-muted">Nenhum pedido.</div>}
      {requests.map((r) => (
        <div key={r.id} className="flex items-center gap-3 border-b border-row px-4 py-2">
          <Avatar name={r.profile.name} />
          <div className="min-w-0 flex-1">
            <div className="truncate">{r.profile.name}</div>
            <div className="text-xs text-muted">@{r.profile.username}</div>
          </div>
          <button
            className="btn h-9 px-3 text-sm"
            disabled={busy === r.id}
            onClick={async () => {
              setBusy(r.id)
              const { data, error } = await supabase.rpc('admin_reset_password', { p_profile: r.profile.id })
              setBusy(null)
              if (error) setMsg({ error: friendlyError(error) })
              else {
                setTemp({ name: r.profile.name, password: data })
                load()
              }
            }}
          >
            Gerar senha
          </button>
        </div>
      ))}
      {temp && (
        <Sheet title={`Senha temporária de ${temp.name}`} subtitle="Passe para o jogador por fora do app (WhatsApp, pessoalmente). Ele cria a senha dele no primeiro acesso." onClose={() => setTemp(null)}>
          <div className="rounded-xl border border-line-2 p-4 text-center font-mono text-3xl font-bold tracking-wider select-all">{temp.password}</div>
          <button
            className="btn mt-3 flex w-full items-center justify-center gap-2"
            onClick={() => navigator.clipboard?.writeText(temp.password).then(() => setMsg({ ok: 'Senha copiada.' }), () => {})}
          >
            <Copy size={16} /> Copiar senha
          </button>
          <button className="mt-2 h-11 w-full text-sm text-muted" onClick={() => setTemp(null)}>
            Fechar
          </button>
          <p className="text-xs text-muted">Ela só aparece agora. Se perder, gere outra.</p>
        </Sheet>
      )}

      {confirmNew && (
        <Sheet title="Gerar novo código?" subtitle="O código atual deixa de funcionar. Quem ainda não se cadastrou vai precisar do novo." onClose={() => setConfirmNew(false)}>
          <button
            className="btn w-full"
            onClick={() => {
              setConfirmNew(false)
              run('invite', () => supabase.rpc('generate_invite'), 'Novo código gerado.')
            }}
          >
            Gerar novo código
          </button>
          <button className="mt-2 h-11 w-full text-sm text-muted" onClick={() => setConfirmNew(false)}>
            Cancelar
          </button>
        </Sheet>
      )}
    </div>
  )
}
