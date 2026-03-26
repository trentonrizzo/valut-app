import { PutObjectCommand } from '@aws-sdk/client-s3'
import { requireEnv } from '../api/_env.js'
import { r2Client } from './r2Client.js'

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

export function buildObjectKey({ userId, album, fileName }) {
  const safeUser = sanitizeUserId(userId)
  const albumSlug = slugify(album)
  const safeName = sanitizeFileName(fileName)
  return `${safeUser}/albums/${albumSlug}/${Date.now()}-${randomSuffix()}-${safeName}`
}

export async function uploadFile({ fileBuffer, fileType, userId, album, fileName }) {
  if (!fileBuffer || !fileName || !userId || !album) {
    throw new Error('Missing upload input: fileBuffer, fileName, userId, and album are required')
  }

  const bucket = requireEnv('R2_BUCKET_NAME')
  const publicBase = requireEnv('R2_PUBLIC_URL').replace(/\/$/, '')
  const key = buildObjectKey({ userId, album, fileName })

  try {
    await r2Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: fileBuffer,
        ContentType: fileType || 'application/octet-stream',
      }),
    )
  } catch (error) {
    console.error('R2 ERROR:', error)
    throw error
  }

  return {
    key,
    url: `${publicBase}/${key}`,
  }
}
