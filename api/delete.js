import { DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { requireAuthenticatedUser } from './_auth.js'
import { readJsonBody, sendJson } from './_json.js'
import { getBucket, getR2Client } from './storage/_s3.js'
import { userOwnsStorageKey } from './storage/_keys.js'
import { assertFileOwnedByUser, userClientFromToken } from './storage/_owned.js'

function assertOwnedKey(userId, key) {
  if (!key || !userOwnsStorageKey(userId, key)) {
    const err = new Error('Forbidden storage key')
    err.statusCode = 403
    throw err
  }
}

async function deleteOwnedObject(key, userId) {
  assertOwnedKey(userId, key)
  try {
    await getR2Client().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }))
    return { ok: true, key }
  } catch (error) {
    const err = new Error(error instanceof Error ? error.message : 'R2 delete failed')
    err.statusCode = 502
    throw err
  }
}

async function objectExists(key) {
  try {
    await getR2Client().send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }))
    return true
  } catch {
    return false
  }
}

async function permanentlyDeleteRow(supabase, user, fileId) {
  const row = await assertFileOwnedByUser(supabase, fileId, user.id)
  if (row.user_id !== user.id) {
    const err = new Error('Forbidden')
    err.statusCode = 403
    throw err
  }

  const keys = [row.storage_key, row.thumbnail_key, row.poster_key].filter((k) => typeof k === 'string' && k)
  for (const key of keys) {
    if (!userOwnsStorageKey(user.id, key)) {
      const err = new Error('Refusing to delete a key that is not owned by the caller')
      err.statusCode = 403
      throw err
    }
  }

  for (const key of keys) {
    const existed = await objectExists(key)
    try {
      await deleteOwnedObject(key, user.id)
    } catch (error) {
      if (existed) throw error
    }
    const stillThere = await objectExists(key)
    if (stillThere) {
      const err = new Error(`R2 object still present after delete: ${key}`)
      err.statusCode = 502
      throw err
    }
  }

  await supabase.from('album_files').delete().eq('user_id', user.id).eq('file_id', fileId)
  await supabase.from('file_tags').delete().eq('user_id', user.id).eq('file_id', fileId)
  const { error } = await supabase.from('files').delete().eq('id', fileId).eq('user_id', user.id)
  if (error) {
    const err = new Error(error.message)
    err.statusCode = 400
    throw err
  }
  return { fileId, keys }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' })
  }

  try {
    const { user, accessToken } = await requireAuthenticatedUser(req)
    const body = await readJsonBody(req)
    const action = typeof body.action === 'string' ? body.action.trim() : ''

    if (body.userId && body.userId !== user.id) {
      return sendJson(res, 403, { ok: false, error: 'User mismatch' })
    }

    if (action === 'verify') {
      const key = typeof body.key === 'string' ? body.key.trim() : ''
      assertOwnedKey(user.id, key)
      const exists = await objectExists(key)
      return sendJson(res, 200, { ok: true, exists, key })
    }

    if (action !== 'permanent' && action !== 'empty-trash') {
      return sendJson(res, 400, {
        ok: false,
        error: 'Specify action=permanent or action=empty-trash. Soft delete is a database update, not this route.',
      })
    }

    const supabase = await userClientFromToken(accessToken)

    if (action === 'permanent') {
      const fileId = typeof body.fileId === 'string' ? body.fileId.trim() : ''
      if (!fileId) return sendJson(res, 400, { ok: false, error: 'fileId is required' })
      const out = await permanentlyDeleteRow(supabase, user, fileId)
      return sendJson(res, 200, { ok: true, ...out })
    }

    const { data, error } = await supabase
      .from('files')
      .select('id')
      .eq('user_id', user.id)
      .not('deleted_at', 'is', null)
    if (error) return sendJson(res, 400, { ok: false, error: error.message })
    const ids = (data ?? []).map((r) => r.id)
    const deleted = []
    for (const fileId of ids) {
      await permanentlyDeleteRow(supabase, user, fileId)
      deleted.push(fileId)
    }
    return sendJson(res, 200, { ok: true, deleted: deleted.length })
  } catch (error) {
    const status = error?.statusCode || 400
    console.error('DELETE ERROR:', error)
    return sendJson(res, status, {
      ok: false,
      error: error instanceof Error ? error.message : 'Delete failed',
    })
  }
}
