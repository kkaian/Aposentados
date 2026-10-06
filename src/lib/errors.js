// Traduz mensagens do Supabase/Postgres para o jogador
export function friendlyError(error) {
  const msg = error?.message ?? String(error ?? '')
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Sem conexão. Verifique a internet e tente de novo.'
  if (/row-level security|permission denied/i.test(msg)) return 'Você não tem permissão para isso.'
  if (/duplicate key/i.test(msg)) return 'Isso já foi escolhido ou cadastrado.'
  if (/already registered|already exists/i.test(msg)) return 'Esse nome de usuário já está em uso.'
  if (/Password should be at least/i.test(msg)) return 'A senha precisa ter pelo menos 6 caracteres.'
  return msg || 'Algo deu errado. Tente de novo.'
}
