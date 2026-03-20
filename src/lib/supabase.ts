import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const envUrl = import.meta.env.VITE_SUPABASE_URL
const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * True when both URL and anon key are present (trimmed non-empty).
 * If false, we still create a client with placeholders so this module never throws —
 * @supabase/supabase-js rejects empty strings at init ("supabaseUrl is required"),
 * which was causing a blank screen when env vars were missing (e.g. Vercel without VITE_* set).
 */
export const isSupabaseConfigured =
  typeof envUrl === 'string' &&
  envUrl.trim().length > 0 &&
  typeof envKey === 'string' &&
  envKey.trim().length > 0

if (!isSupabaseConfigured) {
  console.error(
    '[Vault] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Set them in .env locally or in Vercel → Settings → Environment Variables (Production/Preview). Auth will not work until configured.',
  )
}

// Valid-shaped values so createClient never throws; real requests fail until env is set.
const resolvedUrl = isSupabaseConfigured ? envUrl.trim() : 'https://placeholder.supabase.co'
const resolvedKey = isSupabaseConfigured
  ? envKey.trim()
  : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.x'

export const supabase = createClient<Database>(resolvedUrl, resolvedKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
