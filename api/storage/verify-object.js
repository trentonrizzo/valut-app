import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { requireAuthenticatedUser } from '../_auth.js'
import { readJsonBody, sendJson } from '../_json.js'
import { getBucket, getR2Client } from './_s3.js'
import { assertOwnKey } from './_keys.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' })
  }

  try {
    const { user } = await requireAuthenticatedUser(req)
    const body = await readJsonBody(req)
    const key = typeof body.key === 'string' ? body.key.trim() : ''
    const expectedSize = body.expectedSize == null ? null : Number(body.expectedSize)

    if (!key) return sendJson(res, 400, { ok: false, error: 'key is required', code: 'ERR_R2_VERIFY' })
    if (body.userId && body.userId !== user.id) {
      return sendJson(res, 403, { ok: false, error: 'User mismatch', code: 'ERR_R2_VERIFY' })
    }
    assertOwnKey(user.id, key)

    const out = await getR2Client().send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }))
    const contentLength = Number(out.ContentLength ?? 0)
    if (expectedSize != null && Number.isFinite(expectedSize) && contentLength !== expectedSize) {
      return sendJson(res, 409, {
        ok: false,
        code: 'ERR_R2_SIZE',
        error: `R2 object size ${contentLength} does not match expected ${expectedSize}`,
        key,
        contentLength,
        expectedSize,
      })
    }

    return sendJson(res, 200, {
      ok: true,
      verified: true,
      key,
      contentLength,
      contentType: out.ContentType || null,
      etag: out.ETag || null,
    })
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode || error?.statusCode || 404
    return sendJson(res, status >= 400 ? status : 404, {
      ok: false,
      code: 'ERR_R2_VERIFY',
      error: error instanceof Error ? error.message : 'R2 object not found',
    })
  }
}
