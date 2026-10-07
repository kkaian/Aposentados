import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import AdminPresenceSheet from '../components/AdminPresenceSheet'
import PresenceAnswer from '../components/PresenceAnswer'
import { Segmented, Spinner } from '../components/ui'
import { isAdminRole, useAuth } from '../lib/auth'
import { dayLabel, timeLabel } from '../lib/dates'
import { fetchCurrentPelada, fetchEligible } from '../lib/peladas'
import { photoUrl } from '../lib/storage'
import { supabase } from '../lib/supabase'

export default function Presenca() {
  const { id } = useParams()
  const { profile } = useAuth()
  const [pelada, setPelada] = useState()
  const [eligible, setEligible] = useState([])
  const [list, setList] = useState([])
  const [tab, setTab] = useState('vao')
  const [inTeam, setInTeam] = useState(new Set())
  const [marking, setMarking] = useState(null)
  const isAdmin = isAdminRole(profile)

  const load = useCallback(async () => {
    const p = id ? (await supabase.from('peladas').select('*').eq('id', id).maybeSingle()).data : await fetchCurrentPelada()
    setPelada(p ?? null)
    if (!p) return
    const [el, { data }, { data: members }] = await Promise.all([
      fetchEligible(p.id),
      supabase.from('presence_list').select('*').eq('pelada_id', p.id).order('answered_at'),
      supabase.from('team_members').select('profile_id').eq('pelada_id', p.id).eq('is_out', false),
    ])
    setEligible(el)
    setInTeam(new Set((members ?? []).map((m) => m.profile_id).filter(Boolean)))
    setList(data ?? [])
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  // presença em tempo real
  useEffect(() => {
    if (!pelada) return
    const channel = supabase
      .channel(`presence-${pelada.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'presence', filter: `pelada_id=eq.${pelada.id}` }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [pelada, load])

  if (pelada === undefined) return <Spinner />
  if (!pelada) return <div className="p-6 text-center text-muted">Nenhuma pelada marcada.</div>

  const byId = Object.fromEntries(eligible.map((p) => [p.id, p]))
  const going = list.filter((r) => r.answer === 'vou' && !r.waitlisted)
  const waiting = list.filter((r) => r.waitlisted)
  const notGoing = list.filter((r) => r.answer === 'nao_vou')
  const answered = new Set(list.map((r) => r.profile_id))
  const noAnswer = eligible.filter((p) => !answered.has(p.id))
  const mine = list.find((r) => r.profile_id === profile.id)
  const canAnswer = byId[profile.id] && (pelada.status === 'agendada' || pelada.status === 'em_andamento')

  const rows = { vao: going, nao: notGoing, sem: noAnswer.map((p) => ({ profile_id: p.id })), espera: waiting }[tab]
  const badge = { vao: 'Vai', nao: 'Não vai', sem: 'Dúvida', espera: 'Espera' }[tab]

  return (
    <div className="pb-6">
      <div className="card mx-4 mt-3">
        <b>
          {dayLabel(pelada.date)} · {timeLabel(pelada.start_time)} · {pelada.location}
        </b>
        <div className="text-xs text-muted">
          {going.length} de {pelada.max_slots} vagas{waiting.length > 0 && ` · ${waiting.length} na espera`}
        </div>
        {canAnswer ? (
          <PresenceAnswer pelada={pelada} mine={mine} onDone={load} className="mt-3" />
        ) : (
          <div className="mt-2 text-xs text-muted">
            {pelada.status === 'encerrada' ? 'Esta pelada já foi encerrada.' : 'A presença é para mensalistas e diaristas chamados pelo admin.'}
          </div>
        )}
      </div>

      <Segmented
        className="mx-4 mb-2 text-xs"
        value={tab}
        onChange={setTab}
        options={[
          ['vao', `Vão ${going.length}`],
          ['nao', `Não vão ${notGoing.length}`],
          ['sem', `Dúvida ${noAnswer.length}`],
          ['espera', `Espera ${waiting.length}`],
        ]}
      />
      {rows.length === 0 && <div className="px-4 py-4 text-sm text-muted">Ninguém aqui.</div>}
      {rows.map((r, i) => {
        const p = byId[r.profile_id] ?? { name: 'Jogador', id: r.profile_id }
        return (
          <button
            key={r.profile_id}
            type="button"
            disabled={!isAdmin || pelada.status === 'encerrada'}
            onClick={() => setMarking({ person: p, answer: r.answer ?? null })}
            className="flex min-h-14 w-full items-center gap-3 border-b border-row px-4 text-left active:bg-surface-2"
          >
            {tab === 'espera' && <b className="w-5 text-center text-muted">{i + 1}</b>}
            <Avatar name={p.name} src={photoUrl(p.photo_path)} />
            <div className="flex-1">
              <div>{p.name}</div>
              {p.type === 'diarista' && <div className="text-xs text-muted">diarista</div>}
            </div>
            <span className="rounded-full border border-action px-2 py-0.5 text-xs text-action">{badge}</span>
          </button>
        )
      })}
      {isAdmin && pelada.status !== 'encerrada' && (
        <p className="px-4 pt-3 text-xs text-muted">Admin: toque num jogador para marcar se ele vai ou não (ex.: faltou sem avisar).</p>
      )}
      {marking && (
        <AdminPresenceSheet
          pelada={pelada}
          person={marking.person}
          answer={marking.answer}
          inTeam={inTeam.has(marking.person.id)}
          onClose={() => setMarking(null)}
          onDone={() => {
            setMarking(null)
            load()
          }}
        />
      )}
      <p className="px-4 pt-3 text-xs text-muted">
        A presença é só um aviso: os capitães podem escolher qualquer mensalista, menos quem disse "Não vou". Quem já está num
        time e desiste deixa uma vaga de diarista para os admins preencherem.
      </p>
    </div>
  )
}
