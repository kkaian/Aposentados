import { ChevronDown, Shuffle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Avatar from '../../components/Avatar'
import PlayerPicker from '../../components/PlayerPicker'
import Sheet from '../../components/Sheet'
import { AdminBadge, Notice, SectionLabel, Segmented, Spinner } from '../../components/ui'
import { dayLabel } from '../../lib/dates'
import { friendlyError } from '../../lib/errors'
import { fetchActivePlayers } from '../../lib/peladas'
import { photoUrl } from '../../lib/storage'
import { supabase } from '../../lib/supabase'

const MODES = [
  ['capitaes', 'Capitães'],
  ['invertidos', 'Invertidos'],
  ['dourado', 'Bilhete dourado'],
]

const HOW = {
  capitaes:
    'Depois de confirmar, os capitães têm 24 h livres para escolher, na ordem 1-2-3-4 · 4-1-2-3 · 1-2-3-4 · 1-2-3-4. Depois, cada escolha tem 10 min; sem escolha, o app sorteia. Pode ser escolhido qualquer mensalista (e diarista chamado), menos quem disse que não vai; a presença aparece só como aviso. A escolha termina sozinha no horário da pelada.',
  invertidos:
    'Por 24 h, cada mensalista (menos quem disse que não vai) escolhe o time do capitão em que quer jogar e pode trocar. Time com mais de 4 interessados: o capitão corta quem fica fora; sem cortar até o fim, o app sorteia. Quem foi cortado escolhe outro time dentro das 24 h. No fim, quem sobrou vai para onde falta gente (mensalistas antes dos diaristas chamados) e o que faltar vira vaga de diarista. Kit e cor: cada capitão escolhe quando quiser, até a véspera. Você pode fechar os times antes.',
  dourado:
    'O dono do bilhete monta o time dele primeiro: escolhe os 4 de uma vez (24 h livres; depois, 10 min por escolha ou o app sorteia). Os outros 3 times saem no sorteio logo depois, ou 3 capitães escolhem na ordem 2-3-4 · 4-2-3 · 2-3-4 · 2-3-4. Diarista só entra se faltar mensalista.',
}

export default function DefinirCapitaes() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [pelada, setPelada] = useState()
  const [mensalistas, setMensalistas] = useState([])
  const [going, setGoing] = useState(new Set())
  const [notGoing, setNotGoing] = useState(new Set())
  const [captains, setCaptains] = useState([null, null, null, null])
  const [hasTeams, setHasTeams] = useState(false)
  const [slot, setSlot] = useState(null)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // capitaes: capitães escolhem os jogadores; invertidos: cada mensalista escolhe o time; dourado: bilhete dourado
  const [mode, setMode] = useState('capitaes')
  // bilhete dourado: dono escolhido (null = sortear) e como saem os outros 3 times
  const [golden, setGolden] = useState(null)
  const [rest, setRest] = useState('sorteio')

  useEffect(() => {
    Promise.all([
      supabase.from('peladas').select('*').eq('id', id).single(),
      fetchActivePlayers(),
      supabase.from('presence_list').select('profile_id, answer, waitlisted').eq('pelada_id', id),
      supabase.from('teams').select('captain_order, captain_id').eq('pelada_id', id).order('captain_order'),
    ]).then(([p, players, pres, teams]) => {
      setPelada(p.data)
      setMensalistas(players.filter((x) => x.type === 'mensalista'))
      setGoing(new Set((pres.data ?? []).filter((r) => r.answer === 'vou').map((r) => r.profile_id)))
      setNotGoing(new Set((pres.data ?? []).filter((r) => r.answer === 'nao_vou').map((r) => r.profile_id)))
      if (teams.data?.length === 4 && teams.data.every((t) => t.captain_id)) {
        setCaptains(teams.data.map((t) => t.captain_id))
        setHasTeams(true)
      } else if (teams.data?.length) setHasTeams(true)
    })
  }, [id])

  // no bilhete dourado com capitães, os capitães são os 3 primeiros da lista
  const captainCount = mode === 'dourado' ? (rest === 'capitaes' ? 3 : 0) : 4
  const chosen = captains.slice(0, captainCount)

  async function submit() {
    setConfirm(false)
    setBusy(true)
    setError('')
    const { error } =
      mode === 'dourado'
        ? await supabase.rpc('define_golden', { p_pelada: Number(id), p_golden: golden, p_rest: rest, p_captains: rest === 'capitaes' ? chosen : null })
        : await supabase.rpc(mode === 'invertidos' ? 'define_captains_inverted' : 'define_captains', { p_pelada: Number(id), p_captains: chosen })
    setBusy(false)
    if (error) setError(friendlyError(error))
    else navigate('/times')
  }

  if (!pelada) return <Spinner />

  const byId = Object.fromEntries(mensalistas.map((m) => [m.id, m]))
  const ready = chosen.every(Boolean) && !(golden && chosen.includes(golden))
  const statusOf = (p) => (going.has(p.id) ? 'vai' : notGoing.has(p.id) ? 'disse que não vai' : 'dúvida (não respondeu)')
  const personButton = (personId, label, onClick, number) => (
    <button className="flex h-14 w-full items-center gap-3 rounded-lg border border-line-2 bg-surface px-3 text-left" onClick={onClick}>
      {number != null && <b className="w-5 text-center text-muted">{number}</b>}
      {personId ? (
        <>
          <Avatar name={byId[personId]?.name ?? ''} src={photoUrl(byId[personId]?.photo_path)} size={32} />
          <span className="flex-1">{byId[personId]?.name}</span>
        </>
      ) : (
        <span className="flex-1 text-muted">{label}</span>
      )}
      <ChevronDown size={18} className="text-muted" />
    </button>
  )

  return (
    <div className="pb-6">
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="text-sm text-muted">{dayLabel(pelada.date)}</span>
        <AdminBadge />
      </div>

      <SectionLabel>Como montar os times</SectionLabel>
      <Segmented className="mx-4 text-xs" value={mode} onChange={setMode} options={MODES} />

      {mode === 'dourado' && (
        <>
          <SectionLabel>Bilhete dourado</SectionLabel>
          <div className="space-y-2 px-4">
            {golden ? (
              personButton(golden, '', () => setSlot('golden'))
            ) : (
              <div className="flex h-14 items-center gap-3 rounded-lg border border-gold/60 px-3 text-sm">
                <Shuffle size={18} className="text-gold" />
                <span className="flex-1">O app sorteia ao confirmar (primeiro entre quem disse que vai)</span>
              </div>
            )}
            <div className="flex gap-2">
              <button className="btn-ghost flex-1 text-sm" onClick={() => setSlot('golden')}>
                {golden ? 'Trocar' : 'Escolher quem ganha'}
              </button>
              {golden && (
                <button className="btn-ghost flex-1 text-sm" onClick={() => setGolden(null)}>
                  Sortear
                </button>
              )}
            </div>
          </div>
          <SectionLabel>Os outros 3 times</SectionLabel>
          <Segmented
            className="mx-4"
            value={rest}
            onChange={setRest}
            options={[
              ['sorteio', 'Sorteio'],
              ['capitaes', '3 capitães'],
            ]}
          />
        </>
      )}

      {captainCount > 0 && (
        <>
          <p className="px-4 pt-3 text-sm text-muted">
            {mode === 'capitaes'
              ? 'Escolha 4 mensalistas. A ordem abaixo é a ordem das escolhas (o 1º escolhe primeiro). Os times valem só para esta pelada.'
              : mode === 'invertidos'
                ? 'Escolha 4 mensalistas para capitães. Os outros mensalistas escolhem em qual time querem jogar.'
                : 'Escolha 3 mensalistas para capitães dos outros times, na ordem das escolhas.'}
          </p>
          <SectionLabel>Capitães</SectionLabel>
          <div className="space-y-2 px-4">
            {chosen.map((c, i) => (
              <div key={i}>{personButton(c, 'Escolher capitão', () => setSlot(i), mode === 'dourado' ? i + 2 : i + 1)}</div>
            ))}
          </div>
        </>
      )}

      <div className="card mx-4 mt-4 text-sm">
        <b>Como funciona</b>
        <p className="mt-1 text-muted">{HOW[mode]}</p>
      </div>

      <div className="space-y-2 px-4 pt-4">
        <Notice>{error}</Notice>
        <button className="btn w-full" disabled={!ready || busy} onClick={() => (hasTeams ? setConfirm(true) : submit())}>
          {mode === 'dourado' ? (golden ? 'Confirmar bilhete dourado' : 'Sortear bilhete dourado') : 'Confirmar capitães'}
        </button>
      </div>

      {slot === 'golden' && (
        <PlayerPicker
          title="Quem ganha o bilhete dourado?"
          players={mensalistas.filter((m) => !notGoing.has(m.id) && !(rest === 'capitaes' && chosen.includes(m.id)))}
          selectedIds={[golden]}
          renderSub={statusOf}
          onPick={(p) => {
            setGolden(p.id)
            setSlot(null)
          }}
          onClose={() => setSlot(null)}
        />
      )}
      {typeof slot === 'number' && (
        <PlayerPicker
          title={`Capitão ${mode === 'dourado' ? slot + 2 : slot + 1}`}
          players={mensalistas.filter((m) => (!chosen.includes(m.id) || chosen[slot] === m.id) && m.id !== golden)}
          selectedIds={[captains[slot]]}
          renderSub={statusOf}
          onPick={(p) => {
            setCaptains((cs) => cs.map((c, i) => (i === slot ? p.id : c)))
            setSlot(null)
          }}
          onClose={() => setSlot(null)}
        />
      )}
      {confirm && (
        <Sheet title="Refazer os times?" subtitle="Esta pelada já tem times. Confirmar apaga as escolhas feitas e recomeça." onClose={() => setConfirm(false)}>
          <button className="btn w-full" onClick={submit}>
            Recomeçar
          </button>
          <button className="mt-2 h-11 w-full text-sm text-muted" onClick={() => setConfirm(false)}>
            Cancelar
          </button>
        </Sheet>
      )}
    </div>
  )
}
