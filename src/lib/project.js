// Endereço e chave pública do projeto Supabase (usados pelo app e pela função /api/push).
// A chave "publishable" foi feita para ficar no app; quem protege os dados são as permissões (RLS) no banco.
export const PROJECT_URL = 'https://sfbzyfgmdtbohnpnfsmu.supabase.co'
export const PUBLISHABLE_KEY = 'sb_publishable_LPp6R_4SBTLFa9Z_pvyRnQ_9OKVVWmb'

// Chave pública das notificações (VAPID); a privada fica só no banco
export const VAPID_PUBLIC_KEY = 'BAOBIx2wRbcAoGq1fWyW4xwsuRbCBqFsS9wY-DFPC5E1GU2RYaDnXMC4o-t4seUrCqfnH77AJSWGO0mzIoQA7mE'
