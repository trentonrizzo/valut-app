import { CreateMultipartUploadCommand } from '@aws-sdk/client-s3'
import { requireAuthenticatedUser } from '../_auth.js'
import { readJsonBody, sendJson } from '../_json.js'
import { getBucket, getR2Client } from './_s3.js'
import { assertOwnKey, originalKey } from './_keys.js'

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

    const out = await getR2Client().send(
      new CreateMultipartUploadCommand({
        Bucket: getBucket(),
        Key: key,
        ContentType: contentType,
      }),
    )

    if (!out.UploadId) {
      return sendJson(res, 500, { ok: false, error: 'Multipart init did not return uploadId' })
    }

    return sendJson(res, 200, { ok: true, key, uploadId: out.UploadId })
  } catch (error) {
    const status = error?.statusCode || 400
    console.error('MULTIPART INIT ERROR:', error)
    return sendJson(res, status, {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to start multipart upload',
    })
  }
}
