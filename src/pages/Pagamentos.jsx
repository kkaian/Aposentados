import { ChevronDown, ChevronRight, Copy, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import Avatar from '../components/Avatar'
import HolderSelect from '../components/HolderSelect'
import Sheet from '../components/Sheet'
import { Notice, SectionLabel, Spinner } from '../components/ui'
import { isAdminRole, useAuth } from '../lib/auth'
import { addMonths, monthLabel, monthName, monthStart, todayISO } from '../lib/dates'
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

const chargeTitle = (c) => (c.kind === 'mensalidade' ? `Mensalidade de ${monthLabel(c.month).toLowerCase()}` : c.title)

export default function Pagamentos() {
  const { profile } = useAuth()
  const isAdmin = isAdminRole(profile)
  const holders = useHolders()
  const [data, setData] = useState()
  const [msg, setMsg] = useState({})
  const [busy, setBusy] = useState(null)
  const [sheet, setSheet] = useState(null)
  const [confirmFor, setConfirmFor] = useState(null)
  const [showPaid, setShowPaid] = useState(false)

  const load = useCallback(async () => {
    await supabase.rpc('ensure_current_fee')
    const [{ data: settings }, { data: charges }, { data: payments }, { data: players }] = await Promise.all([
      supabase.from('app_settings').select('*').single(),
      supabase.from('charges').select('*').order('created_at', { ascending: false }).limit(60),
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
  const thisMonth = monthStart(today)
  const chargeById = Object.fromEntries(charges.map((c) => [c.id, c]))
  const playerById = Object.fromEntries(players.map((p) => [p.id, p]))
  const isLate = (charge, status) => status !== 'confirmado' && charge.due_date && charge.due_date < today

  // as cobranças do jogador: em aberto primeiro (atrasadas, do mês, adiantadas), depois o histórico pago
  const mine = payments
    .filter((p) => p.profile_id === profile.id && chargeById[p.charge_id])
    .map((p) => ({ ...p, charge: chargeById[p.charge_id] }))
    .sort((a, b) => (a.charge.due_date ?? '9999').localeCompare(b.charge.due_date ?? '9999'))
  const open = mine.filter((p) => p.status !== 'confirmado')
  const paid = mine.filter((p) => p.status === 'confirmado').reverse()

  const fees = charges.filter((c) => c.kind === 'mensalidade').sort((a, b) => b.month.localeCompare(a.month))
  const cotinhas = charges.filter((c) => c.kind === 'cotinha')
  const nextMonth = addMonths(thisMonth, 1)
  const hasNext = fees.some((c) => c.month === nextMonth)
  const pending = payments.filter((p) => p.status === 'informado')
  const billed = (chargeId) => payments.filter((p) => p.charge_id === chargeId)

  async function copyPix() {
    try {
      await navigator.clipboard.writeText(settings.pix_key)
      setMsg({ ok: 'Chave Pix copiada.' })
    } catch {
      setMsg({ error: 'Não deu para copiar. Selecione a chave e copie à mão.' })
    }
  }

  return (
    <div className="pb-6">
      {settings.pix_key && open.length > 0 && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-line-2 p-3">
          <span className="min-w-0 flex-1 truncate text-sm select-all">Pix: {settings.pix_key}</span>
          <button className="flex h-9 items-center gap-1 px-2 text-sm font-semibold text-action" onClick={copyPix}>
            <Copy size={15} /> Copiar
          </button>
        </div>
      )}

      <SectionLabel>Minhas cobranças em aberto · {open.length}</SectionLabel>
      {open.length === 0 && (
        <div className="px-4 text-sm text-muted">{profile.type === 'mensalista' ? 'Tudo pago. Valeu!' : 'Nada a pagar. Mensalidade é só para mensalistas.'}</div>
      )}
      {open.map((p) => (
        <div key={p.charge_id} className="flex min-h-16 items-center gap-3 border-b border-row px-4 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate">{chargeTitle(p.charge)}</div>
            <div className="text-xs text-muted">
              {money(p.charge.amount)}
              {p.charge.due_date && ` · vence ${dateBR(p.charge.due_date)}`}
            </div>
          </div>
          <StatusPill status={p.status} late={isLate(p.charge, p.status)} />
          {p.status === 'pendente' && (
            <button className="btn h-9 px-3 text-sm" disabled={busy === p.charge_id} onClick={() => run(p.charge_id, 'inform_payment', { p_charge: p.charge_id }, 'Avisamos o admin. Ele confirma quando receber.')}>
              Já paguei
            </button>
          )}
        </div>
      ))}
      {open.length > 0 && <p className="px-4 pt-2 text-xs text-muted">Depois de pagar o Pix, toque em "Já paguei". Um admin confirma o recebimento.</p>}

      <div className="space-y-2 px-4 pt-3">
        <Notice>{msg.error}</Notice>
        <Notice kind="ok">{msg.ok}</Notice>
      </div>

      {paid.length > 0 && (
        <>
          <button className="flex w-full items-center gap-1 px-4 pt-4 pb-2 text-xs font-semibold tracking-wide text-muted uppercase" onClick={() => setShowPaid((v) => !v)}>
            {showPaid ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Já pagas · {paid.length}
          </button>
          {showPaid &&
            paid.map((p) => (
              <div key={p.charge_id} className="flex min-h-12 items-center gap-3 border-b border-row px-4">
                <span className="min-w-0 flex-1 truncate text-sm">{chargeTitle(p.charge)}</span>
                <span className="text-xs text-muted">{money(p.charge.amount)}</span>
                <StatusPill status="confirmado" />
              </div>
            ))}
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
                <div className="text-xs text-muted">{chargeById[p.charge_id] && chargeTitle(chargeById[p.charge_id])}</div>
              </div>
              <button className="btn h-9 px-3 text-sm" disabled={busy !== null} onClick={() => setConfirmFor({ charge: chargeById[p.charge_id], profile: playerById[p.profile_id], holder: profile.id })}>
                Confirmar
              </button>
            </div>
          ))}

          <div className="flex items-center justify-between pr-4">
            <SectionLabel>Só admin · mensalidades</SectionLabel>
          </div>
          {!hasNext && (
            <div className="px-4 pb-2">
              <button
                className="btn-outline flex w-full items-center justify-center gap-2"
                disabled={busy === 'next'}
                onClick={() => run('next', 'create_month_fee', { p_month: nextMonth }, `Mensalidade de ${monthName(nextMonth)} criada para os mensalistas.`)}
              >
                <Plus size={16} /> Criar mensalidade de {monthName(nextMonth)}
              </button>
              <p className="mt-1 text-xs text-muted">Cobra os mensalistas de agora (quem virar mensalista depois entra também). Vence dia {settings.fee_due_day}.</p>
            </div>
          )}
          {fees.length === 0 && <div className="px-4 text-sm text-muted">Defina o valor da mensalidade em Mensalistas e cota.</div>}
          {fees.map((c) => {
            const list = billed(c.id)
            const ok = list.filter((p) => p.status === 'confirmado').length
            return (
              <button key={c.id} className="flex min-h-14 w-full items-center gap-3 border-b border-row px-4 text-left" onClick={() => setSheet({ kind: 'quem', charge: c })}>
                <div className="min-w-0 flex-1">
                  <div className="truncate">{monthLabel(c.month)}</div>
                  <div className="text-xs text-muted">
                    {money(c.amount)} · vence {dateBR(c.due_date)}
                  </div>
                </div>
                <span className={`text-sm font-semibold ${ok === list.length && list.length ? 'text-[#7FD3A4]' : 'text-muted'}`}>
                  {ok} de {list.length} pagos
                </span>
                <ChevronRight size={16} className="text-muted" />
              </button>
            )
          })}

          <div className="flex items-center justify-between pr-4">
            <SectionLabel>Só admin · cotinhas</SectionLabel>
            <button className="flex items-center gap-1 text-xs font-semibold text-action" onClick={() => setSheet({ kind: 'cotinha' })}>
              <Plus size={14} /> Nova cotinha
            </button>
          </div>
          {cotinhas.length === 0 && <div className="px-4 text-sm text-muted">Nenhuma cotinha.</div>}
          {cotinhas.map((c) => {
            const list = billed(c.id)
            return (
              <button key={c.id} className="flex min-h-14 w-full items-center gap-3 border-b border-row px-4 text-left" onClick={() => setSheet({ kind: 'quem', charge: c })}>
                <div className="min-w-0 flex-1">
                  <div className="truncate">{c.title}</div>
                  <div className="text-xs text-muted">{money(c.amount)}</div>
                </div>
                <span className="text-sm text-muted">
                  {list.filter((p) => p.status === 'confirmado').length} de {list.length} pagos
                </span>
                <ChevronRight size={16} className="text-muted" />
              </button>
            )
          })}
          <PixForm settings={settings} onSaved={load} />
        </>
      )}

      {sheet?.kind === 'quem' && (
        <Sheet
          title={chargeTitle(sheet.charge)}
          subtitle={`${billed(sheet.charge.id).filter((p) => p.status === 'confirmado').length} de ${billed(sheet.charge.id).length} pagos · ${money(sheet.charge.amount)}`}
          onClose={() => setSheet(null)}
        >
          {billed(sheet.charge.id)
            .map((p) => ({ ...p, player: playerById[p.profile_id] ?? { name: 'Jogador inativo', id: p.profile_id } }))
            .sort((a, b) => a.player.name.localeCompare(b.player.name))
            .map((p) => (
              <div key={p.profile_id} className="flex min-h-12 items-center gap-2 border-b border-row">
                <span className="min-w-0 flex-1 truncate">{p.player.name}</span>
                <StatusPill status={p.status} late={isLate(sheet.charge, p.status)} />
                {p.status !== 'confirmado' ? (
                  <>
                    <button className="h-9 px-2 text-sm font-semibold text-action" onClick={() => setConfirmFor({ charge: sheet.charge, profile: p.player, holder: profile.id })}>
                      Confirmar
                    </button>
                    <button className="h-9 px-1 text-xs text-muted" onClick={() => run(`d${p.profile_id}`, 'dismiss_payment', { p_charge: sheet.charge.id, p_profile: p.profile_id }, `${p.player.name} dispensado desta cobrança.`)}>
                      Dispensar
                    </button>
                  </>
                ) : (
                  <button
                    className="h-9 px-2 text-sm text-muted"
                    onClick={() => run(`u${p.profile_id}`, 'unconfirm_payment', { p_charge: sheet.charge.id, p_profile: p.profile_id, p_reason: 'Confirmação desfeita' }, `Pagamento de ${p.player.name} voltou para pendente.`)}
                  >
                    Desfazer
                  </button>
                )}
              </div>
            ))}
          <p className="mt-2 text-xs text-muted">Dispensar tira a pessoa desta cobrança (ex.: entrou no fim do mês). Desfazer volta um pagamento confirmado por engano.</p>
        </Sheet>
      )}

      {sheet?.kind === 'cotinha' && <CotinhaSheet onClose={() => setSheet(null)} onSaved={load} />}

      {confirmFor && (
        <Sheet title={`Confirmar pagamento de ${confirmFor.profile?.name}`} subtitle={`${chargeTitle(confirmFor.charge)} · ${money(confirmFor.charge.amount)}. Entra no caixa.`} onClose={() => setConfirmFor(null)}>
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
    <Sheet title="Nova cotinha" subtitle="Cobra todos os mensalistas de agora, com pagamento próprio." onClose={onClose}>
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
        <input
          id="pix"
          className="field"
          value={pix}
          onChange={(e) => {
            setPix(e.target.value)
            setSaved(false)
          }}
        />
        <button className="btn" onClick={save}>
          {saved ? 'Salvo' : 'Salvar'}
        </button>
      </div>
      <div className="mt-1 text-xs text-muted">Valor e vencimento da mensalidade ficam em Admin → Mensalistas e cota.</div>
    </div>
  )
}
