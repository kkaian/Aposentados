// Cores dos times (lista fixa, especificação seção 11)
export const TEAM_COLORS = [
  { id: 'azul', name: 'Azul', hex: '#2D5BA8' },
  { id: 'vermelho', name: 'Vermelho', hex: '#B3362B' },
  { id: 'branco', name: 'Branco', hex: '#D8DEE9' },
  { id: 'preto', name: 'Preto', hex: '#1B1B1B' },
  { id: 'verde', name: 'Verde', hex: '#2E8B57' },
  { id: 'amarelo', name: 'Amarelo', hex: '#E0B000' },
  { id: 'laranja', name: 'Laranja', hex: '#E06A1F' },
  { id: 'roxo', name: 'Roxo', hex: '#6B3FA0' },
  { id: 'cinza', name: 'Cinza', hex: '#7A8394' },
  { id: 'grena', name: 'Grená', hex: '#7A1F2B' },
]

// Ordem das escolhas por rodada (posição do capitão, 1 a 4)
export const DRAFT_ORDER = [
  [1, 2, 3, 4],
  [4, 1, 2, 3],
  [1, 2, 3, 4],
  [1, 2, 3, 4],
]

export const TIMEZONE = 'America/Sao_Paulo'

// Supabase Auth exige e-mail: cada usuário recebe um e-mail interno derivado do nome de usuário
export const AUTH_EMAIL_DOMAIN = 'aposentados.app'
export const usernameToEmail = (username) => `${username.trim().toLowerCase()}@${AUTH_EMAIL_DOMAIN}`

export const USERNAME_RE = /^[a-z0-9._]{3,20}$/
