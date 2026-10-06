import { todayISO } from './dates'
import { supabase } from './supabase'

// Próximo domingo (ou hoje, se hoje for domingo)
export function nextSundayISO() {
  const [y, m, d] = todayISO().split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + ((7 - date.getUTCDay()) % 7))
  return date.toISOString().slice(0, 10)
}

// Pelada de hoje ou a próxima (a que o app mostra em "Pelada")
export async function fetchCurrentPelada() {
  const { data } = await supabase
    .from('peladas')
    .select('*')
    .gte('date', todayISO())
    .in('status', ['agendada', 'em_andamento'])
    .order('date')
    .limit(1)
    .maybeSingle()
  if (data) return data
  // sem próxima: a última que ainda está em andamento (ex.: passou da meia-noite)
  const { data: open } = await supabase
    .from('peladas')
    .select('*')
    .eq('status', 'em_andamento')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  return open
}

export async function fetchActivePlayers() {
  const { data } = await supabase
    .from('profiles')
    .select('id, name, username, role, type, photo_path')
    .eq('status', 'ativo')
    .order('name')
  return data ?? []
}

// Quem pode marcar presença: mensalistas + diaristas chamados para esta pelada
export async function fetchEligible(peladaId) {
  const [players, { data: called }] = await Promise.all([
    fetchActivePlayers(),
    supabase.from('pelada_diaristas').select('profile_id').eq('pelada_id', peladaId),
  ])
  const calledIds = new Set((called ?? []).map((c) => c.profile_id))
  return players.filter((p) => p.type === 'mensalista' || calledIds.has(p.id))
}

export const PELADA_STATUS_LABEL = {
  agendada: 'Agendada',
  em_andamento: 'Em andamento',
  encerrada: 'Encerrada',
  cancelada: 'Cancelada',
}
