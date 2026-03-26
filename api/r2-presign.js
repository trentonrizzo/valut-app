import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { requireAuthenticatedUser } from './_auth.js'
import { readJsonBody, sendJson } from './_json.js'
import { requireEnv } from './_env.js'
import { r2Client } from '../lib/r2Client.js'

function slugify(input) {
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled'
}

function sanitizeUserId(input) {
  return String(input)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
}

function sanitizeFileName(input) {
  const base = String(input).trim().replace(/\\/g, '/').split('/').pop() || 'file'
  const dot = base.lastIndexOf('.')
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : ''
  const stem = (dot > 0 ? base.slice(0, dot) : base)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'file'
  return ext ? `${stem}.${ext.slice(0, 12)}` : stem
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10)
}

function safeJoinPublicUrl(publicBase, key) {
  const base = String(publicBase || '').trim().replace(/\/+$/, '')
  const segments = String(key || '')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
  return `${base}/${segments.join('/')}`
}

function buildObjectKey({ userId, album, fileName }) {
  const safeUser = sanitizeUserId(userId)
  const albumSlug = slugify(album)
  const safeName = sanitizeFileName(fileName)
  return `${safeUser}/albums/${albumSlug}/${Date.now()}-${randomSuffix()}-${safeName}`
}

function isAllowedType(contentType) {
  return typeof contentType === 'string' && (contentType.startsWith('image/') || contentType.startsWith('video/'))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' })
  }

  try {
    const { user } = await requireAuthenticatedUser(req)
    const { fileName, contentType, album, userId } = await readJsonBody(req)

    if (!fileName || !contentType || !album || !userId) {
      return sendJson(res, 400, { ok: false, error: 'fileName, contentType, album, userId are required' })
    }

    if (userId !== user.id) {
      return sendJson(res, 403, { ok: false, error: 'User mismatch' })
    }

    if (!isAllowedType(contentType)) {
      return sendJson(res, 400, { ok: false, error: 'Only image and video files are supported' })
    }

    const bucket = requireEnv('R2_BUCKET_NAME')
    const publicBase = requireEnv('R2_PUBLIC_URL')
    const key = buildObjectKey({ userId: user.id, album, fileName })

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    })

    const url = await getSignedUrl(r2Client, command, { expiresIn: 300 })

    return sendJson(res, 200, {
      ok: true,
      url,
      key,
      publicUrl: safeJoinPublicUrl(publicBase, key),
      fileName,
    })
  } catch (error) {
    console.error('R2 PRESIGN ERROR:', error)
    return sendJson(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : 'Presign failed',
    })
  }
}
