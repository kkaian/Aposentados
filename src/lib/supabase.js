import { createClient } from '@supabase/supabase-js'

// Endereço e chave pública do projeto. A chave "publishable" foi feita para ficar no app;
// quem protege os dados são as permissões (RLS) no banco. O .env.local pode sobrescrever.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://sfbzyfgmdtbohnpnfsmu.supabase.co'
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_LPp6R_4SBTLFa9Z_pvyRnQ_9OKVVWmb'

export const SUPABASE_URL = url

export const supabase = createClient(url, anonKey)
