import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { requireEnv } from '../api/_env.js'
import { r2Client } from './r2Client.js'

export async function deleteFile(key) {
  if (!key) {
    throw new Error('deleteFile requires a key')
  }

  const bucket = requireEnv('R2_BUCKET_NAME')

  try {
    await r2Client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    )
  } catch (error) {
    console.error('R2 ERROR:', error)
    throw error
  }

  return { success: true }
}
