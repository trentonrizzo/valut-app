import { S3Client } from '@aws-sdk/client-s3'

let cached = null

export function getBucket() {
  const bucket = process.env.R2_BUCKET || process.env.R2_BUCKET_NAME
  if (!bucket || !String(bucket).trim()) {
    const err = new Error('R2 bucket is not configured')
    err.statusCode = 500
    throw err
  }
  return String(bucket).trim()
}

export function getR2Client() {
  if (cached) return cached
  const endpointRaw = process.env.R2_ENDPOINT
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  if (!endpointRaw || !accessKeyId || !secretAccessKey) {
    const err = new Error('R2 credentials are not configured')
    err.statusCode = 500
    throw err
  }
  const endpoint = `https://${String(endpointRaw).trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`
  cached = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  })
  return cached
}
