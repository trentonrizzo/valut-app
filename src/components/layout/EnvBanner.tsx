import { isSupabaseConfigured } from '../../lib/supabase'

/** Shown when Supabase env vars are missing so the UI is never a silent blank screen. */
export function EnvBanner() {
  if (isSupabaseConfigured) return null

  return (
    <div className="env-banner" role="alert">
      <strong>Configuration required.</strong> Set <code>VITE_SUPABASE_URL</code> and{' '}
      <code>VITE_SUPABASE_ANON_KEY</code> in your environment (e.g. Vercel project env vars), then
      redeploy.
    </div>
  )
}
