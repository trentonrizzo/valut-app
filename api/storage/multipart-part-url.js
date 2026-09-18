import { UploadPartCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { requireAuthenticatedUser } from '../_auth.js'
import { readJsonBody, sendJson } from '../_json.js'
import { getBucket, getR2Client } from './_s3.js'
import { assertOwnKey } from './_keys.js'

const PART_EXPIRES = 60 * 60 * 2

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' })
  }

  try {
    const { user } = await requireAuthenticatedUser(req)
    const body = await readJsonBody(req)
    const key = typeof body.key === 'string' ? body.key.trim() : ''
    const uploadId = typeof body.uploadId === 'string' ? body.uploadId.trim() : ''
    const partNumber = Number(body.partNumber)

    if (!key || !uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
      return sendJson(res, 400, { ok: false, error: 'key, uploadId, and valid partNumber are required' })
    }
    if (body.userId && body.userId !== user.id) {
      return sendJson(res, 403, { ok: false, error: 'User mismatch' })
    }
    assertOwnKey(user.id, key)

    const command = new UploadPartCommand({
      Bucket: getBucket(),
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    })
    const url = await getSignedUrl(getR2Client(), command, { expiresIn: PART_EXPIRES })
    return sendJson(res, 200, { ok: true, url, expiresIn: PART_EXPIRES, partNumber })
  } catch (error) {
    const status = error?.statusCode || 400
    console.error('MULTIPART PART URL ERROR:', error)
    return sendJson(res, status, {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to sign part URL',
    })
  }
}
