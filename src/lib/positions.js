// Funções do jogador (profiles.positions): códigos "<função>_<característica>"
export const FUNCTIONS = [
  { key: 'atacante', label: 'Atacante', short: 'ATA', tone: 'border-[#E5604F]/60 text-[#F29A8E]', traits: [['central', 'Central'], ['ponta', 'Ponta']] },
  { key: 'meio', label: 'Meio-campista', short: 'MEI', tone: 'border-[#2E8B57]/70 text-[#7FD3A4]', traits: [['defensivo', 'Defensivo'], ['ofensivo', 'Ofensivo']] },
  { key: 'defensor', label: 'Defensor', short: 'DEF', tone: 'border-action/70 text-[#8FB0FF]', traits: [['central', 'Central'], ['lateral', 'Lateral']] },
]

// Agrupa os códigos por função, na ordem fixa: [{ fn, traits: [label] }]
export function groupPositions(positions = []) {
  return FUNCTIONS.map((fn) => ({
    fn,
    traits: fn.traits.filter(([t]) => positions.includes(`${fn.key}_${t}`)).map(([, label]) => label),
  })).filter((g) => g.traits.length)
}

// Goleiro (profiles.goalkeeper): marcado pelo admin
export const GOALKEEPER_LABEL = { so_goleiro: 'Só goleiro', tambem: 'Também goleiro' }

// Notas de goleiro (goalkeeper_ratings)
export const GK_RATING_FIELDS = [
  ['hands', 'Def. com mãos'],
  ['feet', 'Def. com pés'],
  ['reach', 'Alcance'],
  ['jump', 'Salto'],
  ['overall', 'Overall'],
]
