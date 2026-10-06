import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AdminBadge, Notice, SectionLabel, Segmented, Spinner } from '../../components/ui'
import { friendlyError } from '../../lib/errors'
import { fetchActivePlayers, fetchCurrentPelada } from '../../lib/peladas'
import { supabase } from '../../lib/supabase'
import { fetchTeams } from '../../lib/teams'

// Substituição integral: alguém de fora entra no lugar de um jogador do time
export default function Diarista() {
  const navigate = useNavigate()
  const [pelada, setPelada] = useState()
  const [teams, setTeams] = useState([])
  const [diaristas, setDiaristas] = useState([])
  const [teamId, setTeamId] = useState(null)
  const [outId, setOutId] = useState(null)
  const [mode, setMode] = useState('cadastrado')
  const [inId, setInId] = useState(null)
  const [guestName, setGuestName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      const p = await fetchCurrentPelada()
      setPelada(p ?? null)
      if (!p) return
      const [t, all] = await Promise.all([fetchTeams(p.id), fetchActivePlayers()])
      const inTeams = new Set(t.flatMap((x) => x.active.map((m) => m.profile_id)))
      setTeams(t)
      setTeamId(t[0]?.id ?? null)
      setDiaristas(all.filter((x) => x.type === 'diarista' && !inTeams.has(x.id)))
    })()
  }, [])

  if (pelada === undefined) return <Spinner />
  if (!pelada || teams.length === 0) return <div className="p-6 text-center text-muted">A pelada ainda não tem times montados.</div>

  const team = teams.find((t) => t.id === teamId)
  const outMember = team?.active.find((m) => m.id === outId)
  const inName = mode === 'avulso' ? guestName.trim() : diaristas.find((d) => d.id === inId)?.name
  const ready = outMember && inName

  async function confirm() {
    setBusy(true)
    setError('')
    const { error } = await supabase.rpc('replace_member', {
      p_member: outMember.id,
      p_profile: mode === 'cadastrado' ? inId : null,
      p_guest_name: mode === 'avulso' ? guestName.trim() : null,
    })
    setBusy(false)
    if (error) setError(friendlyError(error))
    else navigate('/times')
  }

  return (
    <div className="pb-6">
      <div className="flex justify-end px-4 pt-3">
        <AdminBadge />
      </div>
      <p className="px-4 text-sm text-muted">O diarista entra no lugar de alguém do time e joga por ele nesta pelada.</p>

      <SectionLabel>Time</SectionLabel>
      <div className="flex flex-wrap gap-2 px-4">
        {teams.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTeamId(t.id)
              setOutId(null)
            }}
            className={`flex h-10 items-center gap-2 rounded-full border px-3.5 text-sm ${t.id === teamId ? 'border-action bg-action/15 text-ink' : 'border-line-2'}`}
          >
            <span className="h-3 w-3 rounded-full" style={{ background: t.color?.hex ?? '#3A4A73' }} />
            {t.label}
          </button>
        ))}
      </div>

      <SectionLabel>Quem fica de fora?</SectionLabel>
      {team?.active.map((m) => (
        <label key={m.id} className="flex min-h-12 items-center gap-3 border-b border-row px-4">
          <input type="radio" name="out" className="h-5 w-5 accent-action" checked={outId === m.id} onChange={() => setOutId(m.id)} />
          <span className="flex-1">{m.name}</span>
          {outId === m.id && <span className="text-xs text-muted">fica de fora</span>}
        </label>
      ))}

      <SectionLabel>Quem entra</SectionLabel>
      <Segmented className="mx-4 mb-2" value={mode} onChange={setMode} options={[['cadastrado', 'Diarista cadastrado'], ['avulso', 'Avulso, sem perfil']]} />
      {mode === 'cadastrado' ? (
        <>
          {diaristas.length === 0 && <div className="px-4 text-sm text-muted">Nenhum diarista cadastrado disponível.</div>}
          {diaristas.map((d) => (
            <label key={d.id} className="flex min-h-12 items-center gap-3 border-b border-row px-4">
              <input type="radio" name="in" className="h-5 w-5 accent-action" checked={inId === d.id} onChange={() => setInId(d.id)} />
              <span className="flex-1">{d.name}</span>
              <span className="text-xs text-muted">diarista</span>
            </label>
          ))}
        </>
      ) : (
        <div className="px-4">
          <input className="field" placeholder="Nome do avulso" maxLength={40} value={guestName} onChange={(e) => setGuestName(e.target.value)} />
          <p className="mt-1 text-xs text-muted">Avulso não tem perfil: gols e assistências dele ficam só no histórico do dia.</p>
        </div>
      )}

      {ready && (
        <div className="card mx-4 mt-4 text-sm">
          {inName} entra no {team.label} no lugar de {outMember.name}.
        </div>
      )}
      <div className="space-y-2 px-4 pt-4">
        <Notice>{error}</Notice>
        <button className="btn w-full" disabled={!ready || busy} onClick={confirm}>
          Confirmar substituição
        </button>
      </div>
    </div>
  )
}
