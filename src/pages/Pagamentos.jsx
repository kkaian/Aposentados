import { Copy, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import Avatar from '../components/Avatar'
import HolderSelect from '../components/HolderSelect'
import Sheet from '../components/Sheet'
import { Notice, SectionLabel, Spinner } from '../components/ui'
import { isAdminRole, useAuth } from '../lib/auth'
import { monthName, todayISO } from '../lib/dates'
import { friendlyError } from '../lib/errors'
import { useHolders } from '../lib/holders'
import { photoUrl } from '../lib/storage'
import { supabase } from '../lib/supabase'

const money = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dateBR = (iso) => (iso ? iso.split('-').reverse().slice(0, 2).join('/') : '')

const STATUS = {
  pendente: ['Pendente', 'border-gold text-gold'],
  informado: ['Aguardando confirmação', 'border-action text-action'],
  confirmado: ['Pago', 'border-[#2E8B57] text-[#7FD3A4]'],
}

function StatusPill({ status, late }) {
  const [label, cls] = late ? ['Atrasado', 'border-[#E5604F] text-[#F29A8E]'] : STATUS[status]
  return <span className={`rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${cls}`}>{label}</span>
}

export default function Pagamentos() {
  const { profile } = useAuth()
  const isAdmin = isAdminRole(profile)
  const [data, setData] = useState()
  const [msg, setMsg] = useState({})
  const [busy, setBusy] = useState(null)
  const [sheet, setSheet] = useState(null)
  const [confirmFor, setConfirmFor] = useState(null)
  const holders = useHolders()

  const load = useCallback(async () => {
    await supabase.rpc('ensure_current_fee')
    const [{ data: settings }, { data: charges }, { data: payments }, { data: players }] = await Promise.all([
      supabase.from('app_settings').select('*').single(),
      supabase.from('charges').select('*').order('created_at', { ascending: false }).limit(30),
      supabase.from('payments').select('*'),
      supabase.from('profiles').select('id, name, photo_path, type').eq('status', 'ativo').order('name'),
    ])
    setData({ settings, charges: charges ?? [], payments: payments ?? [], players: players ?? [] })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function run(key, fn, args, ok) {
    setBusy(key)
    setMsg({})
    const { error } = await supabase.rpc(fn, args)
    setBusy(null)
    if (error) setMsg({ error: friendlyError(error) })
    else {
      if (ok) setMsg({ ok })
      load()
    }
  }

  if (!data) return <Spinner />

  const { settings, charges, payments, players } = data
  const today = todayISO()
  const statusOf = (chargeId, profileId) => payments.find((p) => p.charge_id === chargeId && p.profile_id === profileId)?.status ?? 'pendente'
  const fee = charges.find((c) => c.kind === 'mensalidade' && c.month === `${today.slice(0, 7)}-01`)
  const cotinhas = charges.filter((c) => c.kind === 'cotinha')
  const mensalistas = players.filter((p) => p.type === 'mensalista')
  const isLate = (charge, status) => status !== 'confirmado' && charge.due_date && charge.due_date < today
  const owes = profile.type === 'mensalista'
  const pending = payments.filter((p) => p.status === 'informado')
  const chargeById = Object.fromEntries(charges.map((c) => [c.id, c]))
  const playerById = Object.fromEntries(players.map((p) => [p.id, p]))

  async function copyPix() {
    try {
      await navigator.clipboard.writeText(settings.pix_key)
      setMsg({ ok: 'Chave Pix copiada.' })
    } catch {
      setMsg({ error: 'Não deu para copiar. Selecione a chave e copie à mão.' })
    }
  }

  function payRow(c) {
    const st = statusOf(c.id, profile.id)
    return (
      <div key={c.id} className="flex min-h-14 items-center gap-3 border-b border-row px-4 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate">{c.title}</div>
          <div className="text-xs text-muted">
            {money(c.amount)}
            {c.due_date && ` · vence ${dateBR(c.due_date)}`}
          </div>
        </div>
        <StatusPill status={st} late={isLate(c, st)} />
        {st === 'pendente' && (
          <button className="btn h-9 px-3 text-sm" disabled={busy === c.id} onClick={() => run(c.id, 'inform_payment', { p_charge: c.id }, 'Avisamos o admin. Ele confirma quando receber.')}>
            Já paguei
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="pb-6">
      {owes && fee ? (
        <div className="card mx-4 mt-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Mensalidade de {monthName(fee.month)}</span>
            <StatusPill status={statusOf(fee.id, profile.id)} late={isLate(fee, statusOf(fee.id, profile.id))} />
          </div>
          <div className="mt-1 text-3xl font-bold">{money(fee.amount)}</div>
          <div className="text-xs text-muted">Vence em {dateBR(fee.due_date)}</div>
          {settings.pix_key ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-line-2 p-2">
              <span className="min-w-0 flex-1 truncate text-sm select-all">Pix: {settings.pix_key}</span>
              <button className="flex h-9 items-center gap-1 px-2 text-sm font-semibold text-action" onClick={copyPix}>
                <Copy size={15} /> Copiar
              </button>
            </div>
          ) : (
            <div className="mt-3 text-xs text-muted">O admin ainda não cadastrou a chave Pix.</div>
          )}
          {statusOf(fee.id, profile.id) === 'pendente' && (
            <button className="btn mt-3 w-full" disabled={busy === fee.id} onClick={() => run(fee.id, 'inform_payment', { p_charge: fee.id }, 'Avisamos o admin. Ele confirma quando receber.')}>
              Já paguei
            </button>
          )}
          <div className="mt-2 text-xs text-muted">Depois de pagar, um admin confirma o recebimento.</div>
        </div>
      ) : (
        <div className="card mx-4 mt-3 text-sm text-muted">
          {owes ? 'A mensalidade deste mês ainda não foi configurada pelo admin.' : 'Mensalidade é só para mensalistas.'}
        </div>
      )}

      <div className="space-y-2 px-4 pt-3">
        <Notice>{msg.error}</Notice>
        <Notice kind="ok">{msg.ok}</Notice>
      </div>

      {owes && (
        <>
          <SectionLabel>Cotinhas</SectionLabel>
          {cotinhas.length === 0 && <div className="px-4 text-sm text-muted">Nenhuma cotinha.</div>}
          {cotinhas.map(payRow)}
        </>
      )}

      {isAdmin && (
        <>
          <SectionLabel className="pt-6">Só admin · aguardando confirmação · {pending.length}</SectionLabel>
          {pending.length === 0 && <div className="px-4 text-sm text-muted">Nada para confirmar.</div>}
          {pending.map((p) => (
            <div key={`${p.charge_id}-${p.profile_id}`} className="flex min-h-14 items-center gap-3 border-b border-row px-4">
              <Avatar name={playerById[p.profile_id]?.name ?? ''} src={photoUrl(playerById[p.profile_id]?.photo_path)} />
              <div className="min-w-0 flex-1">
                <div className="truncate">{playerById[p.profile_id]?.name}</div>
                <div className="text-xs text-muted">
                  {chargeById[p.charge_id]?.kind === 'mensalidade' ? `Mensalidade de ${monthName(chargeById[p.charge_id].month)}` : chargeById[p.charge_id]?.title}
                </div>
              </div>
              <button className="btn h-9 px-3 text-sm" disabled={busy !== null} onClick={() => setConfirmFor({ charge: chargeById[p.charge_id], profile: playerById[p.profile_id], holder: profile.id })}>
                Confirmar
              </button>
            </div>
          ))}

          <div className="flex gap-2 px-4 pt-3">
            {fee && (
              <button className="btn-ghost flex-1 text-sm" onClick={() => setSheet({ kind: 'quem', charge: fee })}>
                Ver quem está em dia
              </button>
            )}
            <button className="btn-ghost flex flex-1 items-center justify-center gap-1 text-sm" onClick={() => setSheet({ kind: 'cotinha' })}>
              <Plus size={16} /> Nova cotinha
            </button>
          </div>
          {cotinhas.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pt-2">
              {cotinhas.map((c) => (
                <button key={c.id} className="h-9 rounded-full border border-line-2 px-3 text-xs" onClick={() => setSheet({ kind: 'quem', charge: c })}>
                  Quem pagou: {c.title}
                </button>
              ))}
            </div>
          )}
          <PixForm settings={settings} onSaved={load} />
        </>
      )}

      {sheet?.kind === 'quem' && (
        <Sheet
          title={sheet.charge.kind === 'mensalidade' ? `Mensalidade de ${monthName(sheet.charge.month)}` : sheet.charge.title}
          subtitle={`${mensalistas.filter((m) => statusOf(sheet.charge.id, m.id) === 'confirmado').length} de ${mensalistas.length} pagos`}
          onClose={() => setSheet(null)}
        >
          {mensalistas.map((m) => {
            const st = statusOf(sheet.charge.id, m.id)
            return (
              <div key={m.id} className="flex min-h-12 items-center gap-3 border-b border-row">
                <span className="flex-1">{m.name}</span>
                <StatusPill status={st} late={isLate(sheet.charge, st)} />
                {st !== 'confirmado' ? (
                  <button className="h-9 px-2 text-sm font-semibold text-action" onClick={() => setConfirmFor({ charge: sheet.charge, profile: m, holder: profile.id })}>
                    Confirmar
                  </button>
                ) : (
                  <button
                    className="h-9 px-2 text-sm text-muted"
                    onClick={() => run(`u${m.id}`, 'unconfirm_payment', { p_charge: sheet.charge.id, p_profile: m.id, p_reason: 'Confirmação desfeita' }, `Pagamento de ${m.name} voltou para pendente.`)}
                  >
                    Desfazer
                  </button>
                )}
              </div>
            )
          })}
        </Sheet>
      )}
      {sheet?.kind === 'cotinha' && <CotinhaSheet onClose={() => setSheet(null)} onSaved={load} />}

      {confirmFor && (
        <Sheet
          title={`Confirmar pagamento de ${confirmFor.profile?.name}`}
          subtitle={`${confirmFor.charge.kind === 'mensalidade' ? `Mensalidade de ${monthName(confirmFor.charge.month)}` : confirmFor.charge.title} · ${money(confirmFor.charge.amount)}. Entra no caixa.`}
          onClose={() => setConfirmFor(null)}
        >
          <HolderSelect holders={holders} value={confirmFor.holder} onChange={(h) => setConfirmFor((c) => ({ ...c, holder: h }))} label="Quem recebeu o dinheiro" />
          <button
            className="btn mt-3 w-full"
            disabled={busy !== null}
            onClick={() => {
              const c = confirmFor
              setConfirmFor(null)
              run('confirm', 'confirm_payment', { p_charge: c.charge.id, p_profile: c.profile.id, p_holder: c.holder }, `Pagamento de ${c.profile.name} confirmado e lançado no caixa.`)
            }}
          >
            Confirmar e lançar no caixa
          </button>
          <button className="mt-2 h-11 w-full text-sm text-muted" onClick={() => setConfirmFor(null)}>
            Cancelar
          </button>
          <p className="text-xs text-muted">Apertou errado? Em "Ver quem está em dia", toque em Desfazer.</p>
        </Sheet>
      )}
    </div>
  )
}

function CotinhaSheet({ onClose, onSaved }) {
  const [form, setForm] = useState({ title: '', amount: '', due: '' })
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function save() {
    const { error } = await supabase.rpc('create_cotinha', { p_title: form.title, p_amount: Number(form.amount), p_due: form.due || null })
    if (error) setError(friendlyError(error))
    else {
      onClose()
      onSaved()
    }
  }

  return (
    <Sheet title="Nova cotinha" subtitle="Vale para todos os mensalistas, com pagamento próprio." onClose={onClose}>
      <label className="label" htmlFor="ct">O que é</label>
      <input id="ct" className="field" placeholder="Ex.: bola nova" maxLength={40} value={form.title} onChange={set('title')} />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="ca">Valor (R$)</label>
          <input id="ca" className="field" type="number" min="0" step="0.01" inputMode="decimal" value={form.amount} onChange={set('amount')} />
        </div>
        <div>
          <label className="label" htmlFor="cd">Vencimento</label>
          <input id="cd" className="field" type="date" value={form.due} onChange={set('due')} />
        </div>
      </div>
      <div className="mt-3">
        <Notice>{error}</Notice>
      </div>
      <button className="btn mt-3 w-full" disabled={!form.title.trim() || !(Number(form.amount) > 0)} onClick={save}>
        Criar cotinha
      </button>
      <button className="mt-2 h-11 w-full text-sm text-muted" onClick={onClose}>
        Cancelar
      </button>
    </Sheet>
  )
}

function PixForm({ settings, onSaved }) {
  const [pix, setPix] = useState(settings.pix_key ?? '')
  const [saved, setSaved] = useState(false)
  async function save() {
    const { error } = await supabase.from('app_settings').update({ pix_key: pix.trim() || null }).eq('id', true)
    if (!error) {
      setSaved(true)
      onSaved()
    }
  }
  return (
    <div className="card mx-4 mt-4">
      <label className="label" htmlFor="pix">Chave Pix que aparece para os jogadores</label>
      <div className="flex gap-2">
        <input id="pix" className="field" value={pix} onChange={(e) => {
            setPix(e.target.value)
            setSaved(false)
          }} />
        <button className="btn" onClick={save}>
          {saved ? 'Salvo' : 'Salvar'}
        </button>
      </div>
      <div className="mt-1 text-xs text-muted">Valor e vencimento da mensalidade ficam em Admin → Mensalistas e cota.</div>
    </div>
  )
}
