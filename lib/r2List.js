import { ListObjectsV2Command } from '@aws-sdk/client-s3'
import { requireEnv } from '../api/_env.js'
import { r2Client } from './r2Client.js'

function sanitizeUserId(input) {
  return String(input)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
}

export async function listUserFiles(userId, albumSlug) {
  if (!userId) throw new Error('listUserFiles requires userId')

  const bucket = requireEnv('R2_BUCKET_NAME')
  const safeUser = sanitizeUserId(userId)
  const safeAlbum = typeof albumSlug === 'string' ? albumSlug.trim() : ''
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

  return contents
    .filter((obj) => obj && obj.Key)
    .map((obj) => ({
      key: obj.Key,
      size: obj.Size ?? 0,
      lastModified: obj.LastModified ? obj.LastModified.toISOString() : null,
    }))
}
