import { CheckCircle2, Circle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AdminBadge, Notice, SectionLabel, Spinner } from '../components/ui'
import { dayLabel } from '../lib/dates'
import { friendlyError } from '../lib/errors'
import { daySummary, fetchPeladaGames, makeNamer } from '../lib/games'
import { supabase } from '../lib/supabase'
import { fetchTeams } from '../lib/teams'

export default function EncerrarPelada() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      const [{ data: pelada }, teams, g, { data: guests }, { data: profiles }] = await Promise.all([
        supabase.from('peladas').select('*').eq('id', id).single(),
        fetchTeams(id),
        fetchPeladaGames(id),
        supabase.from('guests').select('id, name').eq('pelada_id', id),
        supabase.from('profiles').select('id, name'),
      ])
      const name = makeNamer(profiles ?? [], guests ?? [])
      setData({ pelada, games: g.games, summary: daySummary(g.games, g.events, teams, name) })
    })()
  }, [id])

  async function close() {
    setBusy(true)
    setError('')
    const { error } = await supabase.rpc('close_pelada', { p_pelada: Number(id) })
    setBusy(false)
    if (error) setError(friendlyError(error))
    else navigate('/')
  }

  if (!data) return <Spinner />
  const { pelada, games, summary } = data
  const finished = games.filter((g) => g.status === 'finalizado').length
  const allDone = games.length > 0 && finished === games.length

  return (
    <div className="pb-6">
      <div className="flex justify-end px-4 pt-3">
        <AdminBadge />
      </div>
      <div className="card mx-4 mt-1">
        <b>
          {dayLabel(pelada.date)} · {pelada.location}
        </b>
        <div className="text-xs text-muted">
          {summary.games} jogos · {summary.goals} gols
        </div>
      </div>

      <SectionLabel>Resumo do dia</SectionLabel>
      <div className="mx-4 divide-y divide-row rounded-xl border border-line">
        {[
          ['Artilheiro', summary.scorer ? `${summary.scorer.names.join(', ')} · ${summary.scorer.n} gols` : '–'],
          ['Garçom', summary.assister ? `${summary.assister.names.join(', ')} · ${summary.assister.n} assistências` : '–'],
          ['Time com mais vitórias', summary.champions.length ? `${summary.champions.map((t) => t.label).join(', ')} · ${summary.bestWins}V` : '–'],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 p-3 text-sm">
            <span className="text-muted">{k}</span>
            <b className="text-right">{v}</b>
          </div>
        ))}
      </div>

      <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-line p-3 text-sm">
        {allDone ? <CheckCircle2 size={18} className="text-[#7FD3A4]" /> : <Circle size={18} className="text-muted" />}
        <span className="flex-1">Todos os jogos encerrados</span>
        <span className="text-muted">
          {finished} de {games.length}
        </span>
      </div>

      <p className="px-4 pt-3 text-xs text-muted">Ao encerrar, os números do dia entram nas estatísticas e no pódio do mês. Depois disso, só admin edita.</p>
      <div className="space-y-2 px-4 pt-3">
        <Notice>{error}</Notice>
        <button className="btn w-full" disabled={!allDone || busy || pelada.status === 'encerrada'} onClick={close}>
          {pelada.status === 'encerrada' ? 'Pelada encerrada' : 'Encerrar pelada'}
        </button>
        <button className="h-11 w-full text-sm text-muted" onClick={() => navigate(-1)}>
          Voltar
        </button>
      </div>
    </div>
  )
}
