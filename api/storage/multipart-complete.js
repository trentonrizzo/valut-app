import { CompleteMultipartUploadCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { requireAuthenticatedUser } from '../_auth.js'
import { readJsonBody, sendJson } from '../_json.js'
import { getBucket, getR2Client } from './_s3.js'
import { assertOwnKey } from './_keys.js'

function normalizeParts(parts) {
  if (!Array.isArray(parts)) return null
  const out = []
  for (const p of parts) {
    const n = Number(p?.PartNumber ?? p?.partNumber)
    let etag = p?.ETag ?? p?.etag
    if (!Number.isInteger(n) || n < 1 || typeof etag !== 'string' || !etag.trim()) return null
    etag = etag.trim()
    if (etag.startsWith('W/')) etag = etag.slice(2).trim()
    if (!etag.startsWith('"') && !etag.endsWith('"')) etag = `"${etag.replaceAll('"', '')}"`
    out.push({ PartNumber: n, ETag: etag })
  }
  out.sort((a, b) => a.PartNumber - b.PartNumber)
  for (let i = 0; i < out.length; i++) {
    if (out[i].PartNumber !== i + 1) return null
  }
  return out
}

async function objectExists(key) {
  try {
    await getR2Client().send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }))
    return true
  } catch {
    return false
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' })
  }

  try {
    const { user } = await requireAuthenticatedUser(req)
    const body = await readJsonBody(req)
    const key = typeof body.key === 'string' ? body.key.trim() : ''
    const uploadId = typeof body.uploadId === 'string' ? body.uploadId.trim() : ''
    const parts = normalizeParts(body.parts)

    if (!key || !uploadId || !parts || parts.length === 0) {
      return sendJson(res, 400, { ok: false, error: 'key, uploadId, and contiguous parts[] are required' })
    }
    if (body.userId && body.userId !== user.id) {
      return sendJson(res, 403, { ok: false, error: 'User mismatch' })
    }
    assertOwnKey(user.id, key)

    try {
      await getR2Client().send(
        new CompleteMultipartUploadCommand({
          Bucket: getBucket(),
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        }),
      )
    } catch (error) {
      const already = await objectExists(key)
      if (already) {
        return sendJson(res, 200, { ok: true, key, alreadyComplete: true })
      }
      throw error
    }

    return sendJson(res, 200, { ok: true, key })
  } catch (error) {
    const status = error?.statusCode || 400
    console.error('MULTIPART COMPLETE ERROR:', error)
    return sendJson(res, status, {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to complete multipart upload',
      code: 'ERR_MULTIPART_COMPLETE',
    })
  }
}
