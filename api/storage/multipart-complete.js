import { CompleteMultipartUploadCommand, HeadObjectCommand, ListPartsCommand } from '@aws-sdk/client-s3'
import { requireAuthenticatedUser } from '../_auth.js'
import { readJsonBody, sendJson } from '../_json.js'
import { getBucket, getR2Client } from './_s3.js'
import { assertOwnKey } from './_keys.js'

function normalizeEtag(raw) {
  if (typeof raw !== 'string') return null
  let etag = raw.trim()
  if (!etag) return null
  if (/^w\//i.test(etag)) etag = etag.slice(2).trim()
  etag = etag.replace(/"/g, '').trim()
  if (!etag) return null
  return `"${etag}"`
}

function normalizePartList(parts) {
  if (!Array.isArray(parts)) return null
  const out = []
  const seen = new Set()
  for (const p of parts) {
    const n = Number(p?.PartNumber ?? p?.partNumber)
    const etag = normalizeEtag(p?.ETag ?? p?.etag)
    if (!Number.isInteger(n) || n < 1 || !etag) return null
    if (seen.has(n)) return null
    seen.add(n)
    out.push({ PartNumber: n, ETag: etag })
  }
  out.sort((a, b) => a.PartNumber - b.PartNumber)
  for (let i = 0; i < out.length; i++) {
    if (out[i].PartNumber !== i + 1) return null
  }
  return out
}

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

async function listParts(key, uploadId) {
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
  return parts
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' })
  }

  try {
    const { user } = await requireAuthenticatedUser(req)
    const body = await readJsonBody(req)
    const action = typeof body.action === 'string' ? body.action.trim() : 'complete'
    const key = typeof body.key === 'string' ? body.key.trim() : ''
    const uploadId = typeof body.uploadId === 'string' ? body.uploadId.trim() : ''
    const expectedSize = body.expectedSize == null ? null : Number(body.expectedSize)

    if (!key) {
      return sendJson(res, 400, { ok: false, code: 'ERR_MULTIPART_COMPLETE', error: 'key is required' })
    }
    if (body.userId && body.userId !== user.id) {
      return sendJson(res, 403, { ok: false, error: 'User mismatch' })
    }
    assertOwnKey(user.id, key)

    if (action === 'verify') {
      const head = await headObject(key)
      if (!sizeMatches(head, expectedSize)) {
        return sendJson(res, head.exists ? 409 : 404, {
          ok: false,
          code: head.exists ? 'ERR_R2_SIZE' : 'ERR_R2_VERIFY',
          error: head.exists
            ? `R2 object size ${head.contentLength} does not match expected ${expectedSize}`
            : 'R2 object not found',
          key,
          contentLength: head.contentLength,
          expectedSize,
        })
      }
      return sendJson(res, 200, {
        ok: true,
        verified: true,
        key,
        contentLength: head.contentLength,
        contentType: head.contentType,
        etag: head.etag,
      })
    }

    if (action === 'list') {
      if (!uploadId) {
        return sendJson(res, 400, { ok: false, code: 'ERR_MULTIPART_LIST', error: 'uploadId is required' })
      }
      const parts = await listParts(key, uploadId)
      return sendJson(res, 200, { ok: true, key, uploadId, parts })
    }

    const parts = normalizePartList(body.parts)
    if (!uploadId || !parts || parts.length === 0) {
      return sendJson(res, 400, {
        ok: false,
        code: 'ERR_MULTIPART_COMPLETE',
        error: 'key, uploadId, and contiguous parts[] with real ETags are required',
      })
    }

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
