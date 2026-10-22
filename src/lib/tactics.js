// Estratégia do time (gramadinho): sempre 5 na linha; o goleiro fica fora da formação
export const FORMATIONS = ['2-1-2', '1-3-1', '2-2-1', '1-2-2', '3-1-1', '2-3']
export const MAX_INSTRUCTIONS = 5
export const INSTRUCTION_MAX = 80

// Posição de cada uma das 5 vagas no campo (em %), da defesa (embaixo) para o ataque (em cima),
// da esquerda para a direita — a mesma ordem de team_tactics.slots
export function slotSpots(formation) {
  const rows = formation.split('-').map(Number)
  const spots = []
  rows.forEach((n, r) => {
    const y = rows.length === 1 ? 50 : 80 - (r * 56) / (rows.length - 1)
    for (let i = 0; i < n; i++) spots.push({ x: ((i + 1) * 100) / (n + 1), y })
  })
  return spots
}

// Nome da linha de cada vaga (para o capitão saber onde está pondo o jogador)
export function slotRole(formation, index) {
  const rows = formation.split('-').map(Number)
  let r = 0
  for (let acc = rows[0]; index >= acc; acc += rows[++r]);
  if (r === 0) return 'Defesa'
  return r === rows.length - 1 ? 'Ataque' : 'Meio'
}

// Quem ocupa hoje a vaga guardada: segue a cadeia de substituições (replaces_member_id).
// Vaga de diarista sem ninguém, ou jogador que saiu do time, deixa a posição vazia.
export function resolveMember(members, memberId) {
  if (memberId == null) return null
  let m = members.find((x) => x.id === memberId)
  for (let guard = 0; m?.is_out && guard < 20; guard++) {
    const prev = m
    m = members.find((x) => x.replaces_member_id === prev.id)
  }
  return m && !m.is_slot && !m.is_out ? m : null
}
