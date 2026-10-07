import { Check, Lock, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import TeamShield from '../components/TeamShield'
import { Notice, SectionLabel, Spinner } from '../components/ui'
import { isAdminRole, useAuth } from '../lib/auth'
import { DRAFT_ORDER, TEAM_COLORS } from '../lib/constants'
import { todayISO } from '../lib/dates'
import { friendlyError } from '../lib/errors'
import { fetchCurrentPelada } from '../lib/peladas'
import { shieldUrl } from '../lib/storage'
import { supabase } from '../lib/supabase'
import { colorOf, fetchTeams } from '../lib/teams'
import { KitForm } from './admin/Kits'

// Capitão escolhe kit (nome + escudo) e cor; quem escolhe primeiro bloqueia para os outros
export default function MeuTime() {
  const [params] = useSearchParams()
  const teamId = params.get('time') ? Number(params.get('time')) : null
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState()
  const [kitId, setKitId] = useState(null)
  const [color, setColor] = useState(null)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  const [kitForm, setKitForm] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    ;(async () => {
      const pelada = await fetchCurrentPelada()
      if (!pelada) return setData(null)
      const [teams, { data: kits }, { data: settings }, { data: draft }] = await Promise.all([
        fetchTeams(pelada.id),
        supabase.from('kits').select('*').eq('active', true).order('name'),
        supabase.from('app_settings').select('kit_creation_enabled').single(),
        supabase.from('drafts').select('phase, next_pick').eq('pelada_id', pelada.id).maybeSingle(),
      ])
      const mine = teamId ? teams.find((t) => t.id === teamId) : teams.find((t) => t.captain_id === profile.id)
      // durante a escolha, o capitão só mexe em kit e cor na vez dele
      const drafting = draft && draft.phase !== 'concluida'
      const locked = drafting
        ? (mine?.captain_id !== profile.id || DRAFT_ORDER.flat()[draft.next_pick - 1] !== mine?.captain_order) && 'turn'
        : // depois da escolha: quem ficou sem kit ou cor completa até a véspera; admin ajusta sempre
          !isAdminRole(profile) && ((mine?.kit_id && mine?.color) ? 'done' : todayISO() >= pelada.date && 'late')
      setData({ teams, mine, kits: kits ?? [], creation: settings?.kit_creation_enabled, locked })
      setKitId(mine?.kit_id ?? null)
      setColor(mine?.color?.id ?? null)
    })()
  }, [profile, teamId, reload])

  if (data === undefined) return <Spinner />
  if (!data?.mine) {
    return <div className="p-6 text-center text-muted">{isAdminRole(profile) ? 'Time não encontrado.' : 'Você não é capitão nesta pelada.'}</div>
  }
  if (data.locked) {
    return (
      <div className="flex flex-col items-center px-8 pt-12 text-center">
        <Lock size={30} className="mb-3 text-muted" />
        <b className="text-lg">{{ turn: 'Ainda não é a sua vez', done: 'Kit e cor já escolhidos', late: 'Prazo encerrado' }[data.locked]}</b>
        <p className="mt-1 text-sm text-muted">
          {{
            turn: 'Kit e cor só podem ser escolhidos na sua vez de escolher um jogador.',
            done: 'Depois da escolha dos times, kit e cor não mudam mais. Se precisar, fale com um admin.',
            late: 'Kit e cor podiam ser escolhidos até a véspera da pelada. O time fica no padrão.',
          }[data.locked]}
        </p>
        <button className="btn-outline mt-6" onClick={() => navigate('/times')}>
          Voltar para os times
        </button>
      </div>
    )
  }

  const others = data.teams.filter((t) => t.id !== data.mine.id)
  const kitTaken = new Set(others.map((t) => t.kit_id).filter(Boolean))
  const colorTaken = new Set(others.map((t) => t.color?.id).filter(Boolean))
  const kit = data.kits.find((k) => k.id === kitId)
  const preview = { ...data.mine, kit, color: colorOf(color) }

  async function save() {
    setBusy(true)
    setError('')
    const { error } = await supabase.rpc('choose_identity', { p_team: data.mine.id, p_kit: kitId, p_color: color })
    setBusy(false)
    if (error) setError(friendlyError(error))
    else navigate('/times')
  }

  return (
    <div className="pb-6">
      <div className="card mx-4 mt-3 flex items-center gap-3">
        <TeamShield team={preview} size={48} />
        <div>
          <b className="text-lg">{kit?.name ?? data.mine.label}</b>
          <div className="text-xs text-muted">
            {color ? `Time ${colorOf(color).name}` : 'sem cor'}
            {data.mine.captain && ` · Capitão: ${data.mine.captain.name}`}
          </div>
        </div>
      </div>

      <SectionLabel>Kit (nome e escudo)</SectionLabel>
      <div className="grid grid-cols-3 gap-2 px-4">
        {data.kits.map((k) => {
          const taken = kitTaken.has(k.id)
          const on = kitId === k.id
          return (
            <button
              key={k.id}
              disabled={taken}
              onClick={() => setKitId(on ? null : k.id)}
              className={`relative flex flex-col items-center gap-1 rounded-xl border p-2 text-center text-xs disabled:opacity-40 ${on ? 'border-action bg-action/10' : 'border-line'}`}
            >
              <img src={shieldUrl(k.shield_path)} alt="" className="h-14 w-14 rounded-lg object-cover" />
              <span className="line-clamp-2">{k.name}</span>
              {taken && <Lock size={14} className="absolute top-1.5 right-1.5 text-muted" />}
              {on && <Check size={16} className="absolute top-1.5 right-1.5 text-action" />}
            </button>
          )
        })}
      </div>

      <div className="px-4 pt-2">
        <button className="flex h-10 items-center gap-1 text-sm font-semibold text-action" onClick={() => setKitForm(true)}>
          <Plus size={16} /> {data.creation ? 'Criar kit novo' : 'Sugerir kit ao admin'}
        </button>
      </div>

      <SectionLabel>Cor</SectionLabel>
      <div className="flex flex-wrap gap-3 px-4">
        {TEAM_COLORS.map((c) => {
          const taken = colorTaken.has(c.id)
          const on = color === c.id
          return (
            <button
              key={c.id}
              disabled={taken}
              onClick={() => setColor(on ? null : c.id)}
              className="flex w-14 flex-col items-center gap-1 text-[11px] disabled:opacity-30"
              aria-label={c.name}
            >
              <span
                className={`flex h-11 w-11 items-center justify-center rounded-full border-2 ${on ? 'border-action ring-2 ring-action/50' : 'border-line-2'}`}
                style={{ background: c.hex }}
              >
                {on && <Check size={18} className={c.id === 'branco' || c.id === 'amarelo' ? 'text-bg' : 'text-white'} />}
                {taken && <Lock size={14} className="text-white/80" />}
              </span>
              {c.name}
            </button>
          )
        })}
      </div>

      <div className="space-y-2 px-4 pt-4">
        <Notice>{error}</Notice>
        <Notice kind="ok">{ok}</Notice>
        <button className="btn w-full" disabled={busy} onClick={save}>
          Salvar time
        </button>
        <p className="text-xs text-muted">
          Na mesma pelada, quem escolhe primeiro bloqueia o kit e a cor. Na próxima pelada, tudo fica livre de novo.
          {!data.creation && ' Criação de kit novo desativada pelo admin: você pode sugerir um.'}
        </p>
      </div>

      {kitForm && (
        <KitForm
          title={data.creation ? 'Criar kit novo' : 'Sugerir kit ao admin'}
          subtitle={data.creation ? 'O kit entra na lista e já pode ser usado.' : 'O admin aprova e o kit entra na lista.'}
          folder={`sugestoes/${profile.id}`}
          submitLabel={data.creation ? 'Criar kit' : 'Enviar sugestão'}
          onClose={() => setKitForm(false)}
          onSubmit={async (name, path) => {
            if (data.creation) {
              const { data: newId, error } = await supabase.rpc('create_kit_by_captain', { p_name: name, p_shield_path: path })
              if (error) throw error
              setKitId(newId)
              setReload((n) => n + 1)
            } else {
              const { error } = await supabase.from('kit_suggestions').insert({ name, shield_path: path, suggested_by: profile.id })
              if (error) throw error
              setOk('Sugestão enviada ao admin.')
            }
          }}
        />
      )}
    </div>
  )
}
