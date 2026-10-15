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

  await assertPrivateAccess(url, anonKey, token)
  return { user: data.user, accessToken: token }
}

async function assertPrivateAccess(url, anonKey, token) {
  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.rpc('vault_private_access')
  if (error) {
    const msg = String(error.message || error.code || '')
    if (/could not find the function|PGRST202|schema cache/i.test(msg)) return
    const err = new Error('Vault lock check failed')
    err.statusCode = 503
    throw err
  }
  if (data !== true) {
    const err = new Error('Vault is locked')
    err.statusCode = 423
    throw err
  }
}
