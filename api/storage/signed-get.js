import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { requireAuthenticatedUser } from '../_auth.js'
import { sendJson } from '../_json.js'
import { getBucket, getR2Client } from './_s3.js'
import { extractKeyFromStoredUrl, userOwnsStorageKey } from './_keys.js'
import { assertFileOwnedByUser, userClientFromToken } from './_owned.js'

const GET_EXPIRES = 15 * 60

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' })
  }

  try {
    const { user, accessToken } = await requireAuthenticatedUser(req)
    const q = req.query || {}
    const fileId = typeof q.fileId === 'string' ? q.fileId : Array.isArray(q.fileId) ? q.fileId[0] : null
    const variantRaw = typeof q.variant === 'string' ? q.variant : Array.isArray(q.variant) ? q.variant[0] : 'original'
    const variant = variantRaw || 'original'
    if (!fileId) {
      return sendJson(res, 400, { ok: false, error: 'fileId is required' })
    }

    const supabase = await userClientFromToken(accessToken)
    const row = await assertFileOwnedByUser(supabase, fileId, user.id)

    let key = null
    if (variant === 'thumb') key = row.thumbnail_key
    else if (variant === 'poster') key = row.poster_key
    else key = row.storage_key

    if (!key) {
      const extracted = extractKeyFromStoredUrl(row.file_url)
      if (extracted && userOwnsStorageKey(user.id, extracted)) {
        key = extracted
      } else if (row.file_url && /^https?:\/\//i.test(row.file_url)) {
        return sendJson(res, 200, {
          ok: true,
          mode: 'legacy-public',
          url: row.file_url,
          encryptionVersion: row.encryption_version ?? 0,
          expiresIn: null,
        })
      } else if (extracted) {
        key = extracted
      }
    }

    if (!key) {
      return sendJson(res, 404, { ok: false, error: 'No storage object for this file' })
    }

    const command = new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
    })
    const signedUrl = await getSignedUrl(getR2Client(), command, { expiresIn: GET_EXPIRES })

    return sendJson(res, 200, {
      ok: true,
      mode: 'signed',
      url: signedUrl,
      key,
      expiresIn: GET_EXPIRES,
      encryptionVersion: row.encryption_version ?? 0,
      chunkSize: row.encryption_chunk_size,
      wrappedDek: row.wrapped_dek,
      metadata: row.metadata_json,
      mimeType: row.mime_type,
      fileName: row.file_name,
    })
  } catch (error) {
    const status = error?.statusCode || 400
    console.error('SIGNED GET ERROR:', error)
    return sendJson(res, status, {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to sign download',
    })
  }
}
