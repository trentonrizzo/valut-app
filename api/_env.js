export function requireEnv(name) {
  const value = process.env[name]
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return String(value).trim()
}

export function getSupabaseServerEnv() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error('Missing SUPABASE_URL/SUPABASE_ANON_KEY (or VITE_SUPABASE_* fallback)')
  }

  return { url: String(url).trim(), anonKey: String(anonKey).trim() }
}
