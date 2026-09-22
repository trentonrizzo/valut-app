export function requireEnv(name) {
  const value = process.env[name]
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return String(value).trim()
}

/**
 * Server-side Supabase config. Canonical names are SUPABASE_URL / SUPABASE_ANON_KEY.
 * VITE_* is a compatibility fallback only (same values, if present at function runtime).
 * Vite inlines VITE_* into the browser bundle; serverless functions do not see those
 * unless they are also set on the Vercel environment that serves /api/*.
 */
export function resolveSupabaseServerEnv(env = process.env) {
  const url = String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim()
  const anonKey = String(env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim()
  return {
    url,
    anonKey,
    usedCanonicalUrl: Boolean(String(env.SUPABASE_URL || '').trim()),
    usedCanonicalAnon: Boolean(String(env.SUPABASE_ANON_KEY || '').trim()),
  }
}

export function getSupabaseServerEnv(env = process.env) {
  const { url, anonKey } = resolveSupabaseServerEnv(env)
  if (!url || !anonKey) {
    const err = new Error('Missing SUPABASE_URL/SUPABASE_ANON_KEY (or VITE_SUPABASE_* fallback)')
    err.statusCode = 500
    throw err
  }
  return { url, anonKey }
}
