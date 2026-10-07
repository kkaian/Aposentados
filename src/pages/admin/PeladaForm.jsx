import { Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import PlayerPicker from '../../components/PlayerPicker'
import Sheet from '../../components/Sheet'
import { AdminBadge, Notice, SectionLabel, Spinner } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { friendlyError } from '../../lib/errors'
import { fetchActivePlayers, nextSundayISO, PELADA_STATUS_LABEL } from '../../lib/peladas'
import { supabase } from '../../lib/supabase'

function Chips({ people, onRemove, onAdd, addLabel = 'Adicionar', disabled }) {
  return (
    <div className="flex flex-wrap gap-2 px-4">
      {people.map((p) => (
        <button
          key={p.id}
          type="button"
          disabled={disabled}
          className="flex h-10 items-center gap-1 rounded-full border border-line-2 pr-2 pl-3.5 text-sm"
          onClick={() => onRemove(p)}
          aria-label={`Remover ${p.name}`}
        >
          {p.name} <X size={16} className="text-muted" />
        </button>
      ))}
      <button
        type="button"
        disabled={disabled}
        className="flex h-10 items-center gap-1 rounded-full border border-dashed border-action px-3.5 text-sm text-action"
        onClick={onAdd}
      >
        <Plus size={16} /> {addLabel}
      </button>
    </div>
  )
}

export default function PeladaForm() {
  const { id } = useParams()
  const isNew = !id
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [pelada, setPelada] = useState(isNew ? null : undefined)
  const [form, setForm] = useState({ date: nextSundayISO(), start_time: '08:00', location: '', max_slots: 20, presence_open: true })
  const [players, setPlayers] = useState([])
  const [helperIds, setHelperIds] = useState([])
  const [diaristaIds, setDiaristaIds] = useState([])
  // diarista só quando falta mensalista (alguém disse "não vou" ou há menos de 20 mensalistas)
  const [diaristasOk, setDiaristasOk] = useState(true)
  const [picker, setPicker] = useState(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [msg, setMsg] = useState({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetchActivePlayers().then(setPlayers)
    if (isNew) {
      // sugere o local da última pelada
      supabase
        .from('peladas')
        .select('location, start_time, max_slots')
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => data && setForm((f) => ({ ...f, location: data.location, start_time: data.start_time.slice(0, 5), max_slots: data.max_slots })))
      return
    }
    setPelada(undefined)
    Promise.all([
      supabase.from('peladas').select('*').eq('id', id).single(),
      supabase.from('pelada_helpers').select('profile_id').eq('pelada_id', id),
      supabase.from('pelada_diaristas').select('profile_id').eq('pelada_id', id),
      supabase.rpc('diaristas_liberados', { p_pelada: Number(id) }),
    ]).then(([p, h, d, ok]) => {
      setDiaristasOk(ok.data !== false)
      setPelada(p.data)
      setForm({ ...p.data, start_time: p.data.start_time.slice(0, 5) })
      setHelperIds((h.data ?? []).map((x) => x.profile_id))
      setDiaristaIds((d.data ?? []).map((x) => x.profile_id))
    })
  }, [id, isNew])

  const byId = Object.fromEntries(players.map((p) => [p.id, p]))
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const locked = pelada && ['encerrada', 'cancelada'].includes(pelada.status)

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setMsg({})
    const fields = {
      date: form.date,
      start_time: form.start_time,
      location: form.location.trim(),
      max_slots: Number(form.max_slots),
      presence_open: form.presence_open,
    }
    try {
      if (isNew) {
        const { data, error } = await supabase.from('peladas').insert({ ...fields, created_by: profile.id }).select().single()
        if (error) throw error
        if (helperIds.length) {
          const { error: e2 } = await supabase.from('pelada_helpers').insert(helperIds.map((pid) => ({ pelada_id: data.id, profile_id: pid })))
          if (e2) throw e2
        }
        navigate(`/admin/peladas/${data.id}`, { replace: true })
        return
      }
      const { error } = await supabase.from('peladas').update(fields).eq('id', id)
      if (error) throw error
      setMsg({ ok: 'Pelada salva.' })
    } catch (err) {
      setMsg({ error: /peladas_date_key/.test(err.message) ? 'Já existe uma pelada nessa data.' : friendlyError(err) })
    }
    setBusy(false)
  }

  // Na edição, ajudantes e diaristas salvam na hora
  async function toggle(table, ids, setIds, person) {
    const on = ids.includes(person.id)
    if (isNew) return setIds(on ? ids.filter((x) => x !== person.id) : [...ids, person.id])
    setMsg({})
    const q = on
      ? supabase.from(table).delete().eq('pelada_id', id).eq('profile_id', person.id)
      : supabase.from(table).insert({ pelada_id: Number(id), profile_id: person.id })
    const { error } = await q
    if (error) setMsg({ error: friendlyError(error) })
    else setIds(on ? ids.filter((x) => x !== person.id) : [...ids, person.id])
  }

  async function cancelPelada() {
    setCancelOpen(false)
    const { error } = await supabase.from('peladas').update({ status: 'cancelada' }).eq('id', id)
    if (error) setMsg({ error: friendlyError(error) })
    else navigate('/admin/peladas')
  }

  if (pelada === undefined) return <Spinner />

  const helpers = helperIds.map((x) => byId[x]).filter(Boolean)
  const diaristas = diaristaIds.map((x) => byId[x]).filter(Boolean)

  return (
    <div className="pb-6">
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="text-sm text-muted">{pelada ? PELADA_STATUS_LABEL[pelada.status] : 'Nova pelada'}</span>
        <AdminBadge />
      </div>

      <form id="pelada" className="grid grid-cols-2 gap-3 px-4 pt-3" onSubmit={save}>
        <div>
          <label className="label" htmlFor="d">Data</label>
          <input id="d" className="field" type="date" value={form.date} onChange={set('date')} required disabled={locked} />
        </div>
        <div>
          <label className="label" htmlFor="h">Horário</label>
          <input id="h" className="field" type="time" value={form.start_time} onChange={set('start_time')} required disabled={locked} />
        </div>
        <div className="col-span-2">
          <label className="label" htmlFor="l">Local</label>
          <input id="l" className="field" value={form.location} onChange={set('location')} maxLength={60} required disabled={locked} />
        </div>
        <div>
          <label className="label" htmlFor="v">Vagas</label>
          <input id="v" className="field" type="number" min="1" inputMode="numeric" value={form.max_slots} onChange={set('max_slots')} required disabled={locked} />
        </div>
        <label className="flex items-end gap-3 pb-3">
          <input type="checkbox" className="h-5 w-5 accent-action" checked={form.presence_open} onChange={set('presence_open')} disabled={locked} />
          <span className="text-sm">Lista de presença aberta</span>
        </label>
      </form>

      <SectionLabel>Ajudantes desta pelada</SectionLabel>
      <Chips
        people={helpers}
        disabled={locked}
        onRemove={(p) => toggle('pelada_helpers', helperIds, setHelperIds, p)}
        onAdd={() => setPicker('helpers')}
      />
      <p className="px-4 pt-2 text-xs text-muted">Ajudantes registram os jogos só nesta pelada.</p>

      {!isNew && (
        <>
          <SectionLabel>Diaristas chamados</SectionLabel>
          <Chips
            people={diaristas}
            disabled={locked}
            onRemove={(p) => toggle('pelada_diaristas', diaristaIds, setDiaristaIds, p)}
            onAdd={() =>
              diaristasOk
                ? setPicker('diaristas')
                : setMsg({ error: 'Diarista só pode ser chamado quando algum mensalista disser que não vai (ou houver menos de 20 mensalistas).' })
            }
          />
          <p className="px-4 pt-2 text-xs text-muted">
            {diaristasOk
              ? 'Falta mensalista para fechar os 20 lugares: dá para chamar diaristas. Eles marcam presença e entram na escolha dos times.'
              : 'Os 20 mensalistas estão disponíveis: diarista só pode ser chamado quando algum disser que não vai.'}{' '}
            Avulsos (sem perfil) entram nas vagas de diarista no dia.
          </p>
        </>
      )}

      <div className="space-y-2 px-4 pt-4">
        <Notice>{msg.error}</Notice>
        <Notice kind="ok">{msg.ok}</Notice>
      </div>

      {!isNew && pelada?.status === 'agendada' && (
        <div className="flex gap-2 px-4 pt-3">
          <Link to={`/admin/peladas/${id}/capitaes`} className="btn-ghost flex flex-1 items-center justify-center text-sm">
            Definir capitães
          </Link>
          <Link to={`/presenca/${id}`} className="btn-ghost flex flex-1 items-center justify-center text-sm">
            Ver presença
          </Link>
        </div>
      )}

      {!locked && (
        <div className="px-4 pt-3">
          <button form="pelada" className="btn w-full" disabled={busy}>
            {isNew ? 'Criar pelada' : 'Salvar alterações'}
          </button>
          {!isNew && pelada?.status === 'agendada' && (
            <button className="mt-2 h-11 w-full text-sm text-[#F29A8E]" onClick={() => setCancelOpen(true)}>
              Cancelar pelada
            </button>
          )}
        </div>
      )}

      {picker === 'helpers' && (
        <PlayerPicker
          title="Ajudantes"
          subtitle="Quem pode registrar os jogos desta pelada."
          players={players}
          selectedIds={helperIds}
          renderSub={(p) => p.type}
          onPick={(p) => toggle('pelada_helpers', helperIds, setHelperIds, p)}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === 'diaristas' && (
        <PlayerPicker
          title="Chamar diaristas"
          subtitle="Eles poderão marcar presença nesta pelada."
          players={players.filter((p) => p.type === 'diarista')}
          selectedIds={diaristaIds}
          onPick={(p) => toggle('pelada_diaristas', diaristaIds, setDiaristaIds, p)}
          onClose={() => setPicker(null)}
        />
      )}
      {cancelOpen && (
        <Sheet title="Cancelar esta pelada?" subtitle="Ela some da tela inicial. Não dá para desfazer pelo app." onClose={() => setCancelOpen(false)}>
          <button className="btn w-full border-[#B3362B] bg-[#B3362B]" onClick={cancelPelada}>
            Cancelar pelada
          </button>
          <button className="mt-2 h-11 w-full text-sm text-muted" onClick={() => setCancelOpen(false)}>
            Voltar
          </button>
        </Sheet>
      )}
    </div>
  )
}
