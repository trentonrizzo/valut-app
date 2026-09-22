import { describe, expect, it } from 'vitest'
import { getSupabaseServerEnv, resolveSupabaseServerEnv } from '../api/_env.js'

describe('server Supabase env resolver', () => {
  it('prefers canonical SUPABASE_URL / SUPABASE_ANON_KEY', () => {
    const resolved = resolveSupabaseServerEnv({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon-canonical',
      VITE_SUPABASE_URL: 'https://vite.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-vite',
    })
    expect(resolved.url).toBe('https://example.supabase.co')
    expect(resolved.anonKey).toBe('anon-canonical')
    expect(resolved.usedCanonicalUrl).toBe(true)
    expect(resolved.usedCanonicalAnon).toBe(true)
  })

  it('falls back to VITE_ names when canonical is missing', () => {
    const env = getSupabaseServerEnv({
      VITE_SUPABASE_URL: 'https://vite.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-vite',
    })
    expect(env.url).toBe('https://vite.supabase.co')
    expect(env.anonKey).toBe('anon-vite')
  })

  it('throws the known missing-env message when neither scope is set', () => {
    expect(() => getSupabaseServerEnv({})).toThrow(
      'Missing SUPABASE_URL/SUPABASE_ANON_KEY (or VITE_SUPABASE_* fallback)',
    )
  })
})
