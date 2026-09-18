import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const url = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

export const supabaseConfigError: string | null =
  !url || !anonKey
    ? 'This deployment is missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Add both in the Vercel project environment (Production) and redeploy.'
    : null

export const supabase = createClient<Database>(
  url || 'https://example.supabase.co',
  anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.invalid',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)
