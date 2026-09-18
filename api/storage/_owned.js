import { createClient } from '@supabase/supabase-js'
import { getSupabaseServerEnv } from '../_env.js'

export async function userClientFromToken(accessToken) {
  const { url, anonKey } = getSupabaseServerEnv()
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}

export async function assertFileOwnedByUser(supabase, fileId, userId) {
  const { data, error } = await supabase
    .from('files')
    .select(
      'id, user_id, file_url, storage_key, encryption_version, wrapped_dek, encryption_chunk_size, metadata_json, mime_type, file_name, thumbnail_key, poster_key, is_encrypted',
    )
    .eq('id', fileId)
    .eq('user_id', userId)
    .maybeSingle()

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
