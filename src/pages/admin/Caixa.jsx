import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ChevronLeft, ChevronRight, Download, Minus, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import HolderSelect from '../../components/HolderSelect'
import { useHolders } from '../../lib/holders'
import Sheet from '../../components/Sheet'
import { AdminBadge, Notice, SectionLabel, Spinner } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { addMonths, monthLabel, monthName, monthStart, todayISO } from '../../lib/dates'
import { friendlyError } from '../../lib/errors'
import { supabase } from '../../lib/supabase'

const money = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dateBR = (iso) => iso.split('-').reverse().slice(0, 2).join('/')

const CATEGORY = {
  mensalidade: 'Mensalidade',
  cotinha: 'Cotinha',
  diarista: 'Diarista',
  avulsa: 'Entrada',
  gasto: 'Gasto',
  transferencia: 'Repasse',
}

// efeito de um lançamento no saldo total (repasse entre admins não muda o total)
const signed = (e) => (e.kind === 'entrada' ? Number(e.amount) : e.kind === 'saida' ? -Number(e.amount) : 0)

function NewEntrySheet({ kind, holders, me, onClose, onSaved }) {
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [holder, setHolder] = useState(me)
  const [toHolder, setToHolder] = useState(holders.find((h) => h.id !== me)?.id ?? '')
  const [date, setDate] = useState(todayISO())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const title = { entrada: 'Nova entrada', saida: 'Novo gasto', transferencia: 'Repasse entre admins' }[kind]

  async function save() {
    setBusy(true)
    setError('')
    const { error } = await supabase.rpc('cash_add', {
      p_kind: kind,
      p_description: description,
      p_amount: Number(amount),
      p_holder: holder,
      p_to_holder: kind === 'transferencia' ? toHolder : null,
      p_date: date,
    })
    setBusy(false)
    if (error) setError(friendlyError(error))
    else {
      onClose()
      onSaved()
    }
  }

  return (
    <Sheet
      title={title}
      subtitle={kind === 'transferencia' ? 'Quando um admin passa dinheiro do caixa para outro. Não muda o saldo total.' : kind === 'saida' ? 'Ex.: society, água, juiz, bola.' : 'Ex.: doação, multa, avulso que pagou.'}
      onClose={onClose}
    >
      <label className="label" htmlFor="desc">{kind === 'saida' ? 'Gasto com' : 'Descrição'}</label>
      <input id="desc" className="field" maxLength={80} placeholder={kind === 'saida' ? 'Society' : kind === 'transferencia' ? 'Repasse' : 'Doação'} value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="val">Valor (R$)</label>
          <input id="val" className="field" type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="dt">Data</label>
          <input id="dt" className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="mt-3">
        <HolderSelect
          holders={holders}
          value={holder}
          onChange={setHolder}
          label={kind === 'entrada' ? 'Dinheiro ficou com' : kind === 'saida' ? 'Quem pagou' : 'Quem passou o dinheiro'}
        />
      </div>
      {kind === 'transferencia' && (
        <div className="mt-3">
          <HolderSelect id="to" holders={holders.filter((h) => h.id !== holder)} value={toHolder} onChange={setToHolder} label="Para quem" />
        </div>
      )}
      <div className="mt-3">
        <Notice>{error}</Notice>
      </div>
      <button className="btn mt-3 w-full" disabled={!description.trim() || !(Number(amount) > 0) || busy || (kind === 'transferencia' && !toHolder)} onClick={save}>
        Lançar
      </button>
      <button className="mt-2 h-11 w-full text-sm text-muted" onClick={onClose}>
        Cancelar
      </button>
    </Sheet>
  )
}

function toCSV(rows) {
  const cols = Object.keys(rows[0])
  const esc = (v) => (v == null ? '' : /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  return '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\n')
}

export default function Caixa() {
  const { profile } = useAuth()
  const holders = useHolders()
  const [month, setMonth] = useState(monthStart(todayISO()))
  const [entries, setEntries] = useState()
  const [names, setNames] = useState({})
  const [sheet, setSheet] = useState(null)
  const [voidReason, setVoidReason] = useState('')
  const [msg, setMsg] = useState({})

  const load = useCallback(async () => {
    const [{ data }, { data: people }] = await Promise.all([
      supabase.from('cash_entries').select('*').order('date').order('id'),
      supabase.from('profiles').select('id, name'),
    ])
    setEntries(data ?? [])
    setNames(Object.fromEntries((people ?? []).map((p) => [p.id, p.name])))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (!entries) return <Spinner />

  const valid = entries.filter((e) => !e.voided_at)
  const next = addMonths(month, 1)
  const inMonth = entries.filter((e) => e.date >= month && e.date < next)
  const validMonth = inMonth.filter((e) => !e.voided_at)
  const income = validMonth.filter((e) => e.kind === 'entrada').reduce((s, e) => s + Number(e.amount), 0)
  const spent = validMonth.filter((e) => e.kind === 'saida').reduce((s, e) => s + Number(e.amount), 0)
  const before = valid.filter((e) => e.date < month).reduce((s, e) => s + signed(e), 0)
  const after = before + income - spent

  // com quem está o dinheiro (tudo até hoje)
  const balance = {}
  for (const e of valid) {
    if (e.kind === 'entrada') balance[e.holder_id] = (balance[e.holder_id] ?? 0) + Number(e.amount)
    if (e.kind === 'saida') balance[e.holder_id] = (balance[e.holder_id] ?? 0) - Number(e.amount)
    if (e.kind === 'transferencia') {
      balance[e.holder_id] = (balance[e.holder_id] ?? 0) - Number(e.amount)
      balance[e.to_holder_id] = (balance[e.to_holder_id] ?? 0) + Number(e.amount)
    }
  }
  const holderIds = [...new Set([...holders.map((h) => h.id), ...Object.keys(balance)])]

  function exportMonth() {
    if (!inMonth.length) return setMsg({ error: 'Nada lançado neste mês.' })
    const rows = inMonth.map((e) => ({
      data: e.date,
      tipo: CATEGORY[e.category] ?? e.category,
      descricao: e.description,
      valor: (signed(e) || Number(e.amount)).toFixed(2).replace('.', ','),
      com: names[e.holder_id],
      para: e.to_holder_id ? names[e.to_holder_id] : '',
      lancado_por: names[e.created_by],
      estornado: e.voided_at ? `sim (${e.void_reason ?? 'sem motivo'}) por ${names[e.voided_by]}` : '',
    }))
    const url = URL.createObjectURL(new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `caixa-${month.slice(0, 7)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function voidEntry() {
    const { error } = await supabase.rpc('cash_void', { p_entry: sheet.entry.id, p_reason: voidReason })
    setSheet(null)
    setVoidReason('')
    if (error) setMsg({ error: friendlyError(error) })
    else {
      setMsg({ ok: 'Lançamento estornado. Ele continua no histórico, riscado.' })
      load()
    }
  }

  return (
    <div className="pb-6">
      <div className="flex items-center px-2 pt-2">
        <button className="flex h-11 w-11 items-center justify-center" aria-label="Mês anterior" onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft size={22} />
        </button>
        <b className="flex-1 text-center">Caixa de {monthLabel(month).toLowerCase()}</b>
        <button className="flex h-11 w-11 items-center justify-center disabled:opacity-30" aria-label="Próximo mês" disabled={month >= monthStart(todayISO())} onClick={() => setMonth(next)}>
          <ChevronRight size={22} />
        </button>
      </div>
      <div className="flex justify-end px-4">
        <AdminBadge />
      </div>

      <div className="card mx-4 mt-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted">Saldo do mês anterior</span>
          <span>{money(before)}</span>
        </div>
        <div className="mt-1 flex justify-between text-sm">
          <span className="text-muted">Entradas</span>
          <span className="text-[#7FD3A4]">+ {money(income)}</span>
        </div>
        <div className="mt-1 flex justify-between text-sm">
          <span className="text-muted">Gastos</span>
          <span className="text-[#F29A8E]">− {money(spent)}</span>
        </div>
        <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
          <b>Caixa no fim de {monthName(month)}</b>
          <b className={`text-2xl ${after < 0 ? 'text-[#F29A8E]' : ''}`}>{money(after)}</b>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 px-4 pt-3">
        <button className="btn-ghost flex h-12 items-center justify-center gap-1 px-1 text-sm" onClick={() => setSheet({ kind: 'entrada' })}>
          <Plus size={16} /> Entrada
        </button>
        <button className="btn-ghost flex h-12 items-center justify-center gap-1 px-1 text-sm" onClick={() => setSheet({ kind: 'saida' })}>
          <Minus size={16} /> Gasto
        </button>
        <button className="btn-ghost flex h-12 items-center justify-center gap-1 px-1 text-sm" disabled={holders.length < 2} onClick={() => setSheet({ kind: 'transferencia' })}>
          <ArrowLeftRight size={16} /> Repasse
        </button>
      </div>

      <div className="space-y-2 px-4 pt-3">
        <Notice>{msg.error}</Notice>
        <Notice kind="ok">{msg.ok}</Notice>
      </div>

      <SectionLabel>Com quem está o dinheiro (hoje)</SectionLabel>
      <div className="mx-4 divide-y divide-row rounded-xl border border-line">
        {holderIds.map((hid) => (
          <div key={hid} className="flex items-center justify-between p-3 text-sm">
            <span>{names[hid] ?? 'Admin'}</span>
            <b className={(balance[hid] ?? 0) < 0 ? 'text-[#F29A8E]' : ''}>{money(balance[hid] ?? 0)}</b>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pr-4">
        <SectionLabel>Lançamentos de {monthName(month)} · {inMonth.length}</SectionLabel>
        <button className="flex items-center gap-1 text-xs font-semibold text-action" onClick={exportMonth}>
          <Download size={14} /> CSV
        </button>
      </div>
      {inMonth.length === 0 && <div className="px-4 text-sm text-muted">Nada lançado neste mês.</div>}
      {[...inMonth].reverse().map((e) => {
        const Icon = e.kind === 'entrada' ? ArrowDownLeft : e.kind === 'saida' ? ArrowUpRight : ArrowLeftRight
        const color = e.kind === 'entrada' ? 'text-[#7FD3A4]' : e.kind === 'saida' ? 'text-[#F29A8E]' : 'text-muted'
        return (
          <button key={e.id} className={`flex min-h-14 w-full items-center gap-3 border-b border-row px-4 py-2 text-left ${e.voided_at ? 'opacity-45' : ''}`} onClick={() => setSheet({ entry: e })}>
            <Icon size={18} className={color} />
            <div className="min-w-0 flex-1">
              <div className={`truncate text-sm ${e.voided_at ? 'line-through' : ''}`}>{e.description}</div>
              <div className="text-xs text-muted">
                {dateBR(e.date)} · {CATEGORY[e.category] ?? e.category} · {e.kind === 'transferencia' ? `${names[e.holder_id]} → ${names[e.to_holder_id]}` : names[e.holder_id]}
                {e.voided_at && ' · estornado'}
              </div>
            </div>
            <b className={`text-sm whitespace-nowrap ${color} ${e.voided_at ? 'line-through' : ''}`}>
              {e.kind === 'saida' ? '− ' : e.kind === 'entrada' ? '+ ' : ''}
              {money(e.amount)}
            </b>
          </button>
        )
      })}
      <p className="px-4 pt-3 text-xs text-muted">
        Mensalidades e cotinhas entram sozinhas quando o admin confirma o pagamento. Diaristas que pagam para jogar entram pela tela de
        substituição. Nada é apagado: lançamento errado é estornado e fica registrado.
      </p>

      {sheet?.kind && <NewEntrySheet kind={sheet.kind} holders={holders} me={profile.id} onClose={() => setSheet(null)} onSaved={load} />}

      {sheet?.entry && (
        <Sheet title={sheet.entry.description} subtitle={`${CATEGORY[sheet.entry.category] ?? ''} · ${money(sheet.entry.amount)} · ${dateBR(sheet.entry.date)}`} onClose={() => setSheet(null)}>
          <div className="space-y-1 text-sm">
            <div>
              <span className="text-muted">{sheet.entry.kind === 'saida' ? 'Quem pagou: ' : sheet.entry.kind === 'transferencia' ? 'De: ' : 'Ficou com: '}</span>
              {names[sheet.entry.holder_id]}
            </div>
            {sheet.entry.to_holder_id && (
              <div>
                <span className="text-muted">Para: </span>
                {names[sheet.entry.to_holder_id]}
              </div>
            )}
            <div>
              <span className="text-muted">Lançado por: </span>
              {names[sheet.entry.created_by]} em {new Date(sheet.entry.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            </div>
            {sheet.entry.voided_at && (
              <div className="text-[#F29A8E]">
                Estornado por {names[sheet.entry.voided_by]} em {new Date(sheet.entry.voided_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                {sheet.entry.void_reason && ` · "${sheet.entry.void_reason}"`}
              </div>
            )}
          </div>
          {!sheet.entry.voided_at && (
            <>
              <label className="label mt-4" htmlFor="reason">Motivo do estorno (opcional)</label>
              <input id="reason" className="field" maxLength={80} placeholder="Lancei errado" value={voidReason} onChange={(ev) => setVoidReason(ev.target.value)} />
              <button className="btn mt-3 w-full border-[#B3362B] bg-[#B3362B]" onClick={voidEntry}>
                Estornar lançamento
              </button>
              {sheet.entry.charge_id && <p className="mt-2 text-xs text-muted">O pagamento do jogador volta para pendente.</p>}
            </>
          )}
          <button className="mt-2 h-11 w-full text-sm text-muted" onClick={() => setSheet(null)}>
            Fechar
          </button>
        </Sheet>
      )}
    </div>
  )
}
