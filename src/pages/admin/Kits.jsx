import { ImagePlus, Plus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Sheet from '../../components/Sheet'
import { AdminBadge, Notice, SectionLabel, Spinner } from '../../components/ui'
import { friendlyError } from '../../lib/errors'
import { shieldUrl, uploadShield } from '../../lib/storage'
import { supabase } from '../../lib/supabase'

// Formulário de kit (nome + escudo); usado pelo admin e pelo capitão
export function KitForm({ title, subtitle, folder, submitLabel, onSubmit, onClose }) {
  const [name, setName] = useState('')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  async function submit() {
    setBusy(true)
    setError('')
    try {
      const path = file ? await uploadShield(file, folder) : null
      await onSubmit(name.trim(), path)
      onClose()
    } catch (err) {
      setError(friendlyError(err))
    }
    setBusy(false)
  }

  return (
    <Sheet title={title} subtitle={subtitle} onClose={onClose}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="flex h-20 w-20 flex-none items-center justify-center overflow-hidden rounded-xl border border-dashed border-line-2 text-muted"
          onClick={() => fileRef.current?.click()}
          aria-label="Escolher escudo"
        >
          {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={26} />}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) {
              setFile(f)
              setPreview(URL.createObjectURL(f))
            }
          }}
        />
        <div className="flex-1">
          <label className="label" htmlFor="kn">Nome do time</label>
          <input id="kn" className="field" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <div className="mt-3">
        <Notice>{error}</Notice>
      </div>
      <button className="btn mt-3 w-full" disabled={!name.trim() || !file || busy} onClick={submit}>
        {busy ? 'Enviando…' : submitLabel}
      </button>
      <button className="mt-2 h-11 w-full text-sm text-muted" onClick={onClose}>
        Cancelar
      </button>
      <p className="text-xs text-muted">A imagem é reduzida antes do envio para economizar espaço.</p>
    </Sheet>
  )
}

export default function Kits() {
  const [data, setData] = useState()
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState({})

  const load = useCallback(async () => {
    const [{ data: kits }, { data: suggestions }, { data: settings }, { data: people }] = await Promise.all([
      supabase.from('kits').select('*').order('active', { ascending: false }).order('name'),
      supabase.from('kit_suggestions').select('*').eq('status', 'pendente').order('created_at'),
      supabase.from('app_settings').select('kit_creation_enabled').single(),
      supabase.from('profiles').select('id, name'),
    ])
    setData({ kits: kits ?? [], suggestions: suggestions ?? [], creation: settings?.kit_creation_enabled, names: Object.fromEntries((people ?? []).map((p) => [p.id, p.name])) })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function act(promise, ok) {
    setMsg({})
    const { error } = await promise
    if (error) setMsg({ error: friendlyError(error) })
    else {
      if (ok) setMsg({ ok })
      load()
    }
  }

  if (!data) return <Spinner />

  return (
    <div className="pb-6">
      <div className="flex justify-end px-4 pt-3">
        <AdminBadge />
      </div>
      <label className="card mx-4 mt-1 flex items-center gap-3">
        <div className="flex-1">
          <b className="text-sm">Capitães podem criar kit</b>
          <div className="text-xs text-muted">{data.creation ? 'Ligado: o capitão envia nome e escudo e já usa.' : 'Desligado: só escolhem da lista (podem sugerir).'}</div>
        </div>
        <input
          type="checkbox"
          className="h-6 w-6 accent-action"
          checked={data.creation}
          onChange={(e) => act(supabase.from('app_settings').update({ kit_creation_enabled: e.target.checked }).eq('id', true))}
        />
      </label>

      <div className="space-y-2 px-4 pt-3">
        <Notice>{msg.error}</Notice>
        <Notice kind="ok">{msg.ok}</Notice>
      </div>

      <div className="flex items-center justify-between pr-4">
        <SectionLabel>Kits disponíveis · {data.kits.filter((k) => k.active).length}</SectionLabel>
        <button className="flex items-center gap-1 text-sm font-semibold text-action" onClick={() => setAdding(true)}>
          <Plus size={16} /> Adicionar kit
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2 px-4">
        {data.kits.map((k) => (
          <div key={k.id} className={`flex flex-col items-center gap-1 rounded-xl border border-line p-2 text-center text-xs ${k.active ? '' : 'opacity-40'}`}>
            <img src={shieldUrl(k.shield_path)} alt="" className="h-14 w-14 rounded-lg object-cover" />
            <span className="line-clamp-2">{k.name}</span>
            <button className="text-[11px] font-semibold text-action" onClick={() => act(supabase.from('kits').update({ active: !k.active }).eq('id', k.id))}>
              {k.active ? 'Tirar da lista' : 'Voltar à lista'}
            </button>
          </div>
        ))}
      </div>

      <SectionLabel>Sugestões pendentes · {data.suggestions.length}</SectionLabel>
      {data.suggestions.length === 0 && <div className="px-4 text-sm text-muted">Nenhuma sugestão.</div>}
      {data.suggestions.map((s) => (
        <div key={s.id} className="flex min-h-16 items-center gap-3 border-b border-row px-4 py-2">
          {s.shield_path ? <img src={shieldUrl(s.shield_path)} alt="" className="h-12 w-12 rounded-lg object-cover" /> : <span className="h-12 w-12 rounded-lg bg-surface-2" />}
          <div className="min-w-0 flex-1">
            <div className="truncate">{s.name}</div>
            <div className="text-xs text-muted">Por {data.names[s.suggested_by] ?? 'jogador'}</div>
          </div>
          <button className="btn h-9 px-3 text-sm" onClick={() => act(supabase.rpc('review_kit_suggestion', { p_id: s.id, p_approve: true }), `${s.name} entrou na lista.`)}>
            Aprovar
          </button>
          <button className="btn-ghost h-9 px-3 text-sm" onClick={() => act(supabase.rpc('review_kit_suggestion', { p_id: s.id, p_approve: false }))}>
            Recusar
          </button>
        </div>
      ))}

      {adding && (
        <KitForm
          title="Adicionar kit"
          subtitle="Nome e escudo entram juntos na lista dos capitães."
          folder="oficiais"
          submitLabel="Adicionar"
          onClose={() => setAdding(false)}
          onSubmit={async (name, path) => {
            const { error } = await supabase.from('kits').insert({ name, shield_path: path })
            if (error) throw error
            load()
          }}
        />
      )}
    </div>
  )
}
