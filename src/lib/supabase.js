import { createClient } from '@supabase/supabase-js'
import { PROJECT_URL, PUBLISHABLE_KEY } from './project'

// O .env.local pode sobrescrever o projeto (ver lib/project.js)
const url = import.meta.env.VITE_SUPABASE_URL || PROJECT_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || PUBLISHABLE_KEY

export const SUPABASE_URL = url

export const supabase = createClient(url, anonKey)
