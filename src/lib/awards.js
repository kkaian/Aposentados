// Troféus do mês: ícone (por posição) e nome
export const AWARDS = {
  melhor_mes: { icon: ['🏆', '🥈', '🥉'], label: (pos) => `Melhor do mês · ${pos}º lugar` },
  artilheiro: { icon: ['⚽'], label: () => 'Artilheiro do mês' },
  garcom: { icon: ['🎯'], label: () => 'Garçom do mês' },
  mais_vitorias: { icon: ['💪'], label: () => 'Mais vitórias do mês' },
  selecao: { icon: ['⭐'], label: () => 'Seleção do mês' },
}

// Agrupa as linhas da view awards por troféu e posição, na ordem de AWARDS
export function groupAwards(rows) {
  const order = Object.keys(AWARDS)
  const groups = new Map()
  for (const a of rows) {
    const key = `${a.award}-${a.position}`
    if (!groups.has(key)) groups.set(key, { award: a.award, position: a.position, ids: [] })
    groups.get(key).ids.push(a.profile_id)
  }
  return [...groups.values()].sort((a, b) => order.indexOf(a.award) - order.indexOf(b.award) || a.position - b.position)
}
