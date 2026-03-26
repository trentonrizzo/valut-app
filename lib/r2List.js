import { ListObjectsV2Command } from '@aws-sdk/client-s3'
import { requireEnv } from '../api/_env.js'
import { r2Client } from './r2Client.js'

function sanitizeUserId(input) {
  return String(input)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
}

function parseFileMetaFromKey(key) {
  const parts = String(key).split('/')
  const fileName = parts[parts.length - 1] || 'file'
  const albumSlug = parts.length >= 4 ? parts[2] : 'uncategorized'
  return { fileName, albumSlug }
}

export async function listUserFiles(userId, albumSlug) {
  if (!userId) throw new Error('listUserFiles requires userId')

  const bucket = requireEnv('R2_BUCKET_NAME')
  const publicBase = requireEnv('R2_PUBLIC_URL').replace(/\/$/, '')
  const safeUser = sanitizeUserId(userId)
  const safeAlbum = typeof albumSlug === 'string' ? albumSlug : ''
  const prefix = safeAlbum ? `${safeUser}/albums/${safeAlbum}/` : `${safeUser}/albums/`

  let response
  try {
    response = await r2Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: String(prefix),
        MaxKeys: 1000,
      }),
    )
  } catch (error) {
    console.error('R2 ERROR:', error)
    throw error
  }

  const contents = Array.isArray(response?.Contents) ? response.Contents : []

  const files = contents
    .filter((obj) => obj && obj.Key)
    .map((obj) => {
      const key = obj.Key
      const { fileName, albumSlug: inferredAlbum } = parseFileMetaFromKey(key)
      return {
        key,
        url: `${publicBase}/${key}`,
        albumSlug: inferredAlbum,
        fileName,
        size: obj.Size ?? 0,
        lastModified: obj.LastModified ? obj.LastModified.toISOString() : null,
      }
    })

  const albumSet = new Set(files.map((f) => f.albumSlug))

  return {
    files,
    albums: Array.from(albumSet).sort((a, b) => a.localeCompare(b)),
  }
}
