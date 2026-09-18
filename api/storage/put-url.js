import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { requireAuthenticatedUser } from '../_auth.js'
import { readJsonBody, sendJson } from '../_json.js'
import { getBucket, getR2Client } from './_s3.js'
import { assertOwnKey, originalKey } from './_keys.js'
import { ensureBrowserUploadCors } from './_s3.js'

const PUT_EXPIRES = 60 * 60

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' })
  }

  try {
    const { user } = await requireAuthenticatedUser(req)
    const body = await readJsonBody(req)
    const objectId = typeof body.objectId === 'string' ? body.objectId.trim() : ''
    const contentType =
      typeof body.contentType === 'string' && body.contentType.trim()
        ? body.contentType.trim()
        : 'application/octet-stream'
    const requestedKey = typeof body.key === 'string' ? body.key.trim() : ''

    if (!objectId && !requestedKey) {
      return sendJson(res, 400, { ok: false, error: 'objectId or key is required' })
    }
    if (body.userId && body.userId !== user.id) {
      return sendJson(res, 403, { ok: false, error: 'User mismatch' })
    }

    const key = requestedKey || originalKey(user.id, objectId)
    assertOwnKey(user.id, key)
    void ensureBrowserUploadCors()

    const command = new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      ContentType: contentType,
    })
    const uploadUrl = await getSignedUrl(getR2Client(), command, { expiresIn: PUT_EXPIRES })

    return sendJson(res, 200, {
      ok: true,
      key,
      uploadUrl,
      expiresIn: PUT_EXPIRES,
    })
  } catch (error) {
    const status = error?.statusCode || 400
    console.error('PUT-URL ERROR:', error)
    return sendJson(res, status, {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to create upload URL',
    })
  }
}
