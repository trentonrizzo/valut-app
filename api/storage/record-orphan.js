import { requireAuthenticatedUser } from '../_auth.js'
import { readJsonBody, sendJson } from '../_json.js'
import { assertOwnKey } from './_keys.js'
import { userClientFromToken } from './_owned.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' })
  }

  try {
    const { user, accessToken } = await requireAuthenticatedUser(req)
    const body = await readJsonBody(req)
    const storageKey = typeof body.storageKey === 'string' ? body.storageKey.trim() : ''
    if (!storageKey) {
      return sendJson(res, 400, { ok: false, error: 'storageKey is required' })
    }
    if (body.userId && body.userId !== user.id) {
      return sendJson(res, 403, { ok: false, error: 'User mismatch' })
    }
    assertOwnKey(user.id, storageKey)

    const supabase = await userClientFromToken(accessToken)
    const { error } = await supabase.from('storage_orphans').insert({
      user_id: user.id,
      storage_key: storageKey,
      original_name: typeof body.originalName === 'string' ? body.originalName : null,
      file_size_bytes: Number.isFinite(body.fileSizeBytes) ? body.fileSizeBytes : null,
      upload_id: typeof body.uploadId === 'string' ? body.uploadId : null,
      error: typeof body.error === 'string' ? body.error.slice(0, 2000) : 'metadata insert failed',
    })

    if (error) {
      return sendJson(res, 400, { ok: false, error: error.message })
    }
    return sendJson(res, 200, { ok: true })
  } catch (error) {
    const status = error?.statusCode || 400
    console.error('ORPHAN ERROR:', error)
    return sendJson(res, status, {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to record orphan',
    })
  }
}
