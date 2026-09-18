import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { requireAuthenticatedUser } from './_auth.js'
import { sendJson } from './_json.js'
import { getBucket, getR2Client } from './storage/_s3.js'
import { originalKey } from './storage/_keys.js'

const PUT_EXPIRES = 60 * 60

/**
 * V1 compatibility endpoint — NOW REQUIRES a Supabase JWT.
 * Mints a user-scoped object key. Does not return a durable public URL.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' })
  }

  try {
    const { user } = await requireAuthenticatedUser(req)

    let body = req.body
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body)
      } catch {
        body = null
      }
    }
    if (!body || typeof body !== 'object') {
      return sendJson(res, 400, { ok: false, error: 'Invalid JSON body' })
    }
    if (body.userId && body.userId !== user.id) {
      return sendJson(res, 403, { ok: false, error: 'User mismatch' })
    }

    const objectId = typeof body.objectId === 'string' && body.objectId.trim()
      ? body.objectId.trim()
      : crypto.randomUUID()
    const contentType =
      typeof body.contentType === 'string' && body.contentType.trim()
        ? body.contentType.trim()
        : 'application/octet-stream'
    const key = originalKey(user.id, objectId)

    const command = new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      ContentType: contentType,
    })
    const uploadUrl = await getSignedUrl(getR2Client(), command, { expiresIn: PUT_EXPIRES })

    return sendJson(res, 200, {
      ok: true,
      uploadUrl,
      key,
      objectId,
      fileUrl: null,
      expiresIn: PUT_EXPIRES,
    })
  } catch (err) {
    const status = err?.statusCode || 400
    console.error(err)
    return sendJson(res, status, {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to create upload URL',
    })
  }
}
