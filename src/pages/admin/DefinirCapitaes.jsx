import { ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Avatar from '../../components/Avatar'
import PlayerPicker from '../../components/PlayerPicker'
import Sheet from '../../components/Sheet'
import { AdminBadge, Notice, SectionLabel, Spinner } from '../../components/ui'
import { dayLabel } from '../../lib/dates'
import { friendlyError } from '../../lib/errors'
import { fetchActivePlayers } from '../../lib/peladas'
import { photoUrl } from '../../lib/storage'
import { supabase } from '../../lib/supabase'

export default function DefinirCapitaes() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [pelada, setPelada] = useState()
  const [mensalistas, setMensalistas] = useState([])
  const [going, setGoing] = useState(new Set())
  const [captains, setCaptains] = useState([null, null, null, null])
  const [hasTeams, setHasTeams] = useState(false)
  const [slot, setSlot] = useState(null)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('peladas').select('*').eq('id', id).single(),
      fetchActivePlayers(),
      supabase.from('presence_list').select('profile_id, answer, waitlisted').eq('pelada_id', id),
      supabase.from('teams').select('captain_order, captain_id').eq('pelada_id', id).order('captain_order'),
    ]).then(([p, players, pres, teams]) => {
      setPelada(p.data)
      setMensalistas(players.filter((x) => x.type === 'mensalista'))
      setGoing(new Set((pres.data ?? []).filter((r) => r.answer === 'vou' && !r.waitlisted).map((r) => r.profile_id)))
      if (teams.data?.length === 4 && teams.data.every((t) => t.captain_id)) {
        setCaptains(teams.data.map((t) => t.captain_id))
        setHasTeams(true)
      } else if (teams.data?.length) setHasTeams(true)
    })
  }, [id])

  async function submit() {
    setConfirm(false)
    setBusy(true)
    setError('')
    const { error } = await supabase.rpc('define_captains', { p_pelada: Number(id), p_captains: captains })
    setBusy(false)
    if (error) setError(friendlyError(error))
    else navigate('/times')
  }

  if (!pelada) return <Spinner />

  const byId = Object.fromEntries(mensalistas.map((m) => [m.id, m]))
  const ready = captains.every(Boolean)

  return (
    <div className="pb-6">
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="text-sm text-muted">{dayLabel(pelada.date)}</span>
        <AdminBadge />
      </div>
      <p className="px-4 pt-2 text-sm text-muted">
        Escolha 4 mensalistas. A ordem abaixo é a ordem das escolhas (o 1º escolhe primeiro). Os times valem só para esta pelada.
      </p>

      <SectionLabel>Capitães</SectionLabel>
      <div className="space-y-2 px-4">
        {captains.map((c, i) => (
          <button key={i} className="flex h-14 w-full items-center gap-3 rounded-lg border border-line-2 bg-surface px-3 text-left" onClick={() => setSlot(i)}>
            <b className="w-5 text-center text-muted">{i + 1}</b>
            {c ? (
              <>
                <Avatar name={byId[c]?.name ?? ''} src={photoUrl(byId[c]?.photo_path)} size={32} />
                <span className="flex-1">{byId[c]?.name}</span>
              </>
            ) : (
              <span className="flex-1 text-muted">Escolher capitão</span>
            )}
            <ChevronDown size={18} className="text-muted" />
          </button>
        ))}
      </div>

      <div className="card mx-4 mt-4 text-sm">
        <b>Como funciona a escolha</b>
        <p className="mt-1 text-muted">
          Depois de confirmar, os capitães têm 24 h livres para escolher, na ordem 1-2-3-4 · 4-1-2-3 · 1-2-3-4 · 1-2-3-4. Depois,
          cada escolha tem 10 min; sem escolha, o app sorteia. Só podem ser escolhidos jogadores que confirmaram presença. A escolha
          termina sozinha no horário da pelada.
        </p>
      </div>

      <div className="space-y-2 px-4 pt-4">
        <Notice>{error}</Notice>
        <button className="btn w-full" disabled={!ready || busy} onClick={() => (hasTeams ? setConfirm(true) : submit())}>
          Confirmar capitães
        </button>
      </div>

      {slot !== null && (
        <PlayerPicker
          title={`Capitão ${slot + 1}`}
          players={mensalistas.filter((m) => !captains.includes(m.id) || captains[slot] === m.id)}
          selectedIds={[captains[slot]]}
          renderSub={(p) => (going.has(p.id) ? 'confirmou presença' : 'sem presença confirmada')}
          onPick={(p) => {
            setCaptains((cs) => cs.map((c, i) => (i === slot ? p.id : c)))
            setSlot(null)
          }}
          onClose={() => setSlot(null)}
        />
      )}
      {confirm && (
        <Sheet title="Refazer os times?" subtitle="Esta pelada já tem times. Confirmar apaga as escolhas feitas e recomeça com estes capitães." onClose={() => setConfirm(false)}>
          <button className="btn w-full" onClick={submit}>
            Recomeçar escolha
          </button>
          <button className="mt-2 h-11 w-full text-sm text-muted" onClick={() => setConfirm(false)}>
            Cancelar
          </button>
        </Sheet>
      )}
    </div>
  )
}
