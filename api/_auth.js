import { createClient } from '@supabase/supabase-js'
import { getSupabaseServerEnv } from './_env.js'

function extractBearer(req) {
  const header = req.headers.authorization || req.headers.Authorization
  if (!header || typeof header !== 'string') return null
  const m = header.match(/^Bearer\s+(.+)$/i)
  return m?.[1] || null
}

export async function requireAuthenticatedUser(req) {
  const token = extractBearer(req)
  if (!token) {
    const err = new Error('Missing Authorization bearer token')
    err.statusCode = 401
    throw err
  }

  const { url, anonKey } = getSupabaseServerEnv()
  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) {
    const err = new Error('Invalid or expired auth token')
    err.statusCode = 401
    throw err
  }

  return { user: data.user, accessToken: token }
}
