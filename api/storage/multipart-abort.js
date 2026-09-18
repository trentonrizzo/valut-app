import { AbortMultipartUploadCommand } from '@aws-sdk/client-s3'
import { requireAuthenticatedUser } from '../_auth.js'
import { readJsonBody, sendJson } from '../_json.js'
import { getBucket, getR2Client } from './_s3.js'
import { assertOwnKey } from './_keys.js'

/**
 * Aborts an IN-PROGRESS multipart upload only.
 * Does not delete completed originals or unrelated objects.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' })
  }

  try {
    const { user } = await requireAuthenticatedUser(req)
    const body = await readJsonBody(req)
    const key = typeof body.key === 'string' ? body.key.trim() : ''
    const uploadId = typeof body.uploadId === 'string' ? body.uploadId.trim() : ''

    if (!key || !uploadId) {
      return sendJson(res, 400, { ok: false, error: 'key and uploadId are required' })
    }
    if (body.userId && body.userId !== user.id) {
      return sendJson(res, 403, { ok: false, error: 'User mismatch' })
    }
    assertOwnKey(user.id, key)

    await getR2Client().send(
      new AbortMultipartUploadCommand({
        Bucket: getBucket(),
        Key: key,
        UploadId: uploadId,
      }),
    )

    return sendJson(res, 200, { ok: true })
  } catch (error) {
    const status = error?.statusCode || 400
    console.error('MULTIPART ABORT ERROR:', error)
    return sendJson(res, status, {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to abort multipart upload',
    })
  }
}
