import { createClient } from '@supabase/supabase-js'
import { getSupabaseServerEnv } from '../_env.js'

const FULL_SELECT =
  'id, user_id, file_url, storage_key, encryption_version, wrapped_dek, encryption_chunk_size, metadata_json, mime_type, file_name, thumbnail_key, poster_key, is_encrypted'

const LEGACY_SELECT = 'id, user_id, file_url, mime_type, file_name, is_encrypted'

export async function userClientFromToken(accessToken) {
  const { url, anonKey } = getSupabaseServerEnv()
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}

export async function assertFileOwnedByUser(supabase, fileId, userId) {
  let result = await supabase.from('files').select(FULL_SELECT).eq('id', fileId).eq('user_id', userId).maybeSingle()

  if (result.error && /does not exist|42703/i.test(result.error.message)) {
    result = await supabase.from('files').select(LEGACY_SELECT).eq('id', fileId).eq('user_id', userId).maybeSingle()
  }

  const { data, error } = result
  if (error) {
    const err = new Error(error.message)
    err.statusCode = 400
    throw err
  }
  if (!data) {
    const err = new Error('Not found or access denied')
    err.statusCode = 403
    throw err
  }
  return data
}
