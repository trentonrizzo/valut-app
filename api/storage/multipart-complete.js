import { CompleteMultipartUploadCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { requireAuthenticatedUser } from '../_auth.js'
import { readJsonBody, sendJson } from '../_json.js'
import { getBucket, getR2Client } from './_s3.js'
import { assertOwnKey } from './_keys.js'
import { normalizePartList } from './_etag.js'

async function headObject(key) {
  try {
    const out = await getR2Client().send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }))
    return {
      exists: true,
      contentLength: Number(out.ContentLength ?? 0),
      etag: out.ETag || null,
      contentType: out.ContentType || null,
    }
  } catch {
    return { exists: false, contentLength: 0, etag: null, contentType: null }
  }
}

function sizeMatches(head, expectedSize) {
  if (expectedSize == null || !Number.isFinite(expectedSize)) return head.exists
  return head.exists && head.contentLength === expectedSize
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
    const parts = normalizePartList(body.parts)
    const expectedSize = body.expectedSize == null ? null : Number(body.expectedSize)

    if (!key || !uploadId || !parts || parts.length === 0) {
      return sendJson(res, 400, {
        ok: false,
        code: 'ERR_MULTIPART_COMPLETE',
        error: 'key, uploadId, and contiguous parts[] with real ETags are required',
      })
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
          MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag })) },
        }),
      )
    } catch (error) {
      const head = await headObject(key)
      if (sizeMatches(head, expectedSize)) {
        return sendJson(res, 200, {
          ok: true,
          key,
          alreadyComplete: true,
          verified: true,
          contentLength: head.contentLength,
        })
      }
      throw error
    }

    const head = await headObject(key)
    if (!sizeMatches(head, expectedSize)) {
      return sendJson(res, 409, {
        ok: false,
        code: 'ERR_R2_SIZE',
        error: head.exists
          ? `Assembled object size ${head.contentLength} does not match expected ${expectedSize}`
          : 'Multipart complete did not produce an R2 object',
        key,
        contentLength: head.contentLength,
        expectedSize,
      })
    }

    return sendJson(res, 200, {
      ok: true,
      key,
      verified: true,
      contentLength: head.contentLength,
    })
  } catch (error) {
    const status = error?.statusCode || 400
    console.error('MULTIPART COMPLETE ERROR:', error)
    return sendJson(res, status, {
      ok: false,
      code: 'ERR_MULTIPART_COMPLETE',
      error: error instanceof Error ? error.message : 'Failed to complete multipart upload',
    })
  }
}
