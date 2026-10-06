import { TEAM_COLORS } from './constants'
import { supabase } from './supabase'

export const colorOf = (id) => TEAM_COLORS.find((c) => c.id === id)

// Times da pelada com membros, kit e nomes (perfis e avulsos)
export async function fetchTeams(peladaId) {
  const [{ data: teams }, { data: members }, { data: guests }, { data: kits }, { data: profiles }] = await Promise.all([
    supabase.from('teams').select('*').eq('pelada_id', peladaId).order('captain_order'),
    supabase.from('team_members').select('*').eq('pelada_id', peladaId).order('created_at'),
    supabase.from('guests').select('id, name').eq('pelada_id', peladaId),
    supabase.from('kits').select('*'),
    supabase.from('profiles').select('id, name, photo_path, type').eq('status', 'ativo'),
  ])
  const people = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]))
  const guestById = Object.fromEntries((guests ?? []).map((g) => [g.id, g]))
  const kitById = Object.fromEntries((kits ?? []).map((k) => [k.id, k]))

  return (teams ?? []).map((t) => {
    const list = (members ?? [])
      .filter((m) => m.team_id === t.id)
      .map((m) => ({
        ...m,
        name: m.profile_id ? (people[m.profile_id]?.name ?? 'Jogador') : (guestById[m.guest_id]?.name ?? 'Avulso'),
        photo_path: m.profile_id ? people[m.profile_id]?.photo_path : null,
        type: m.profile_id ? people[m.profile_id]?.type : 'avulso',
      }))
      .sort((a, b) => b.is_captain - a.is_captain || (a.pick_number ?? 99) - (b.pick_number ?? 99))
    const captain = t.captain_id ? people[t.captain_id] : null
    const kit = t.kit_id ? kitById[t.kit_id] : null
    return {
      ...t,
      kit,
      captain,
      color: colorOf(t.color),
      members: list,
      active: list.filter((m) => !m.is_out),
      label: kit?.name ?? (captain ? `Time de ${captain.name.split(' ')[0]}` : `Time ${t.captain_order}`),
    }
  })
}
