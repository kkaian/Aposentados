import { useCallback, useEffect, useState } from 'react'
import Avatar from '../../components/Avatar'
import { AdminBadge, Notice, SectionLabel, Spinner } from '../../components/ui'
import { friendlyError } from '../../lib/errors'
import { photoUrl } from '../../lib/storage'
import { supabase } from '../../lib/supabase'

function PlayerRow({ p, sub, action, onAction, disabled }) {
  return (
    <div className="flex items-center gap-3 border-b border-row px-4 py-2">
      <Avatar name={p.name} src={photoUrl(p.photo_path)} />
      <div className="min-w-0 flex-1">
        <div className="truncate">{p.name}</div>
        <div className="text-xs text-muted">{sub}</div>
      </div>
      <button className="btn-ghost h-9 px-3 text-sm" disabled={disabled} onClick={onAction}>
        {action}
      </button>
    </div>
  )
}

export default function Mensalistas() {
  const [settings, setSettings] = useState()
  const [form, setForm] = useState({})
  const [players, setPlayers] = useState([])
  const [msg, setMsg] = useState({})
  const [busy, setBusy] = useState(null)

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([
      supabase.from('app_settings').select('*').single(),
      supabase.from('profiles').select('id, name, role, type, photo_path').eq('status', 'ativo').order('name'),
    ])
    setSettings(s.data)
    setForm({ fee_amount: s.data.fee_amount, fee_due_day: s.data.fee_due_day, mensalista_quota: s.data.mensalista_quota })
    setPlayers(p.data ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function saveSettings(e) {
    e.preventDefault()
    setBusy('settings')
    setMsg({})
    const { error } = await supabase
      .from('app_settings')
      .update({
        fee_amount: Number(form.fee_amount),
        fee_due_day: Number(form.fee_due_day),
        mensalista_quota: Number(form.mensalista_quota),
        updated_at: new Date().toISOString(),
      })
      .eq('id', true)
    setBusy(null)
    if (error) setMsg({ error: friendlyError(error) })
    else {
      setMsg({ ok: 'Configurações salvas.' })
      load()
    }
  }

  async function setType(p, type) {
    setBusy(p.id)
    setMsg({})
    const { error } = await supabase.rpc('set_player_type', { p_profile: p.id, p_type: type })
    setBusy(null)
    if (error) setMsg({ error: friendlyError(error) })
    else load()
  }

  if (!settings) return <Spinner />

  const mensalistas = players.filter((p) => p.type === 'mensalista')
  const diaristas = players.filter((p) => p.type === 'diarista')
  const full = mensalistas.length >= settings.mensalista_quota
  const roleNote = (p) => (p.role === 'dono' ? 'dono · ' : p.role === 'admin' ? 'admin · ' : '')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <div className="pb-6">
      <div className="flex justify-end px-4 pt-3">
        <AdminBadge />
      </div>

      <form className="card mx-4 mt-2 grid grid-cols-2 gap-3" onSubmit={saveSettings}>
        <div>
          <label className="label" htmlFor="fee">Valor (R$)</label>
          <input id="fee" className="field" type="number" min="0" step="0.01" inputMode="decimal" value={form.fee_amount} onChange={set('fee_amount')} />
        </div>
        <div>
          <label className="label" htmlFor="due">Vencimento (dia)</label>
          <input id="due" className="field" type="number" min="1" max="28" inputMode="numeric" value={form.fee_due_day} onChange={set('fee_due_day')} />
        </div>
        <div className="col-span-2">
          <label className="label" htmlFor="quota">Cota de mensalistas</label>
          <div className="flex items-center gap-3">
            <input id="quota" className="field w-28" type="number" min="0" inputMode="numeric" value={form.mensalista_quota} onChange={set('mensalista_quota')} />
            <span className="text-sm text-muted">
              {mensalistas.length} de {settings.mensalista_quota} vagas usadas
            </span>
          </div>
        </div>
        <button className="btn col-span-2" disabled={busy === 'settings'}>
          Salvar
        </button>
      </form>

      <div className="space-y-2 px-4 pt-3">
        <Notice>{msg.error}</Notice>
        <Notice kind="ok">{msg.ok}</Notice>
      </div>

      <SectionLabel>Mensalistas · {mensalistas.length}</SectionLabel>
      {mensalistas.length === 0 && <div className="px-4 text-sm text-muted">Nenhum mensalista ainda.</div>}
      {mensalistas.map((p) => (
        <PlayerRow key={p.id} p={p} sub={`${roleNote(p)}ocupa vaga da cota`} action="Retirar" disabled={busy === p.id} onAction={() => setType(p, 'diarista')} />
      ))}

      <SectionLabel>Diaristas cadastrados · {diaristas.length}</SectionLabel>
      {diaristas.length === 0 && <div className="px-4 text-sm text-muted">Nenhum diarista.</div>}
      {diaristas.map((p) => (
        <PlayerRow
          key={p.id}
          p={p}
          sub={`${roleNote(p)}diarista`}
          action="Tornar mensalista"
          disabled={full || busy === p.id}
          onAction={() => setType(p, 'mensalista')}
        />
      ))}
      {full && diaristas.length > 0 && <div className="px-4 pt-2 text-xs text-muted">Cota cheia: retire alguém ou aumente a cota.</div>}

      <p className="card mx-4 mt-4 text-xs text-muted">
        Quem sai (ou atrasa) deixa de ser elencável, mas o perfil e o histórico continuam. Dono e admins ocupam vaga da cota só
        enquanto forem mensalistas; podem ser retirados e continuar admins.
      </p>
    </div>
  )
}
