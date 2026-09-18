import { ListPartsCommand } from '@aws-sdk/client-s3'
import { requireAuthenticatedUser } from '../_auth.js'
import { readJsonBody, sendJson } from '../_json.js'
import { getBucket, getR2Client } from './_s3.js'
import { assertOwnKey } from './_keys.js'
import { normalizeEtag } from './_etag.js'

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
      return sendJson(res, 400, { ok: false, error: 'key and uploadId are required', code: 'ERR_MULTIPART_LIST' })
    }
    if (body.userId && body.userId !== user.id) {
      return sendJson(res, 403, { ok: false, error: 'User mismatch' })
    }
    assertOwnKey(user.id, key)

    const parts = []
    let marker
    do {
      const out = await getR2Client().send(
        new ListPartsCommand({
          Bucket: getBucket(),
          Key: key,
          UploadId: uploadId,
          PartNumberMarker: marker,
        }),
      )
      for (const p of out.Parts || []) {
        const etag = normalizeEtag(p.ETag)
        if (!p.PartNumber || !etag) continue
        parts.push({ PartNumber: p.PartNumber, ETag: etag, Size: Number(p.Size ?? 0) })
      }
      marker = out.IsTruncated ? out.NextPartNumberMarker : undefined
    } while (marker)

    parts.sort((a, b) => a.PartNumber - b.PartNumber)
    return sendJson(res, 200, { ok: true, key, uploadId, parts })
  } catch (error) {
    const status = error?.statusCode || 400
    console.error('MULTIPART LIST PARTS ERROR:', error)
    return sendJson(res, status, {
      ok: false,
      code: 'ERR_MULTIPART_LIST',
      error: error instanceof Error ? error.message : 'Failed to list multipart parts',
    })
  }
}
