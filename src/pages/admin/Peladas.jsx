import { ChevronRight, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AdminBadge, SectionLabel, Spinner } from '../../components/ui'
import { dayLabel, timeLabel, todayISO } from '../../lib/dates'
import { PELADA_STATUS_LABEL } from '../../lib/peladas'
import { supabase } from '../../lib/supabase'

function Row({ p }) {
  return (
    <Link to={`/admin/peladas/${p.id}`} className="flex min-h-16 items-center gap-3 border-b border-row px-4 active:bg-surface-2">
      <div className="flex-1">
        <div className="font-semibold">
          {dayLabel(p.date)} · {timeLabel(p.start_time)}
        </div>
        <div className="text-xs text-muted">
          {p.location} · {PELADA_STATUS_LABEL[p.status]}
        </div>
      </div>
      <ChevronRight size={18} className="text-muted" />
    </Link>
  )
}

export default function Peladas() {
  const [peladas, setPeladas] = useState()

  useEffect(() => {
    supabase
      .from('peladas')
      .select('*')
      .order('date', { ascending: false })
      .limit(40)
      .then(({ data }) => setPeladas(data ?? []))
  }, [])

  if (!peladas) return <Spinner />

  const today = todayISO()
  const upcoming = peladas.filter((p) => p.date >= today || p.status === 'em_andamento').reverse()
  const past = peladas.filter((p) => !upcoming.includes(p))

  return (
    <div className="pb-6">
      <div className="flex items-center justify-between px-4 pt-3">
        <Link to="/admin/peladas/nova" className="btn flex items-center gap-2">
          <Plus size={18} /> Nova pelada
        </Link>
        <AdminBadge />
      </div>
      <SectionLabel>Próximas</SectionLabel>
      {upcoming.length === 0 && <div className="px-4 text-sm text-muted">Nenhuma pelada marcada.</div>}
      {upcoming.map((p) => (
        <Row key={p.id} p={p} />
      ))}
      {past.length > 0 && <SectionLabel>Anteriores</SectionLabel>}
      {past.map((p) => (
        <Row key={p.id} p={p} />
      ))}
    </div>
  )
}
