import { S3Client } from '@aws-sdk/client-s3'

function required(name) {
  const value = process.env[name]
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return String(value).trim()
}

function normalizeR2Endpoint(raw) {
  const value = String(raw).trim().replace(/\/+$/, '')
  const withoutProtocol = value.replace(/^https?:\/\//i, '')
  const normalized = `https://${withoutProtocol}`

  if (!/^https:\/\/[a-z0-9-]+\.r2\.cloudflarestorage\.com$/i.test(normalized)) {
    throw new Error(
      'Invalid R2_ENDPOINT format. Expected: https://ACCOUNT_ID.r2.cloudflarestorage.com',
    )
  }

  return normalized
}

const endpoint = normalizeR2Endpoint(required('R2_ENDPOINT'))
const accessKeyId = required('R2_ACCESS_KEY_ID')
const secretAccessKey = required('R2_SECRET_ACCESS_KEY')

export const r2Client = new S3Client({
  region: 'auto',
  endpoint,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
  forcePathStyle: true,
})
