import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

function getQueryParam(req, name) {
  const v = req.query?.[name]
  if (typeof v === 'string') return v
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0]
  return null
}

function requireR2Env() {
  const endpoint = process.env.R2_ENDPOINT
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET
  const missing = []
  if (!endpoint?.trim()) missing.push('R2_ENDPOINT')
  if (!accessKeyId?.trim()) missing.push('R2_ACCESS_KEY_ID')
  if (!secretAccessKey?.trim()) missing.push('R2_SECRET_ACCESS_KEY')
  if (!bucket?.trim()) missing.push('R2_BUCKET')
  return { endpoint, accessKeyId, secretAccessKey, bucket, missing }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const fileKeyRaw = getQueryParam(req, 'fileKey')
  const fileKey = fileKeyRaw != null ? String(fileKeyRaw).trim() : ''

  console.info('[signed-url] incoming fileKey:', fileKey || '(empty)')

  if (!fileKey) {
    return res.status(400).json({ error: 'fileKey is required' })
  }

  const env = requireR2Env()
  if (env.missing.length > 0) {
    console.error('[signed-url] missing env:', env.missing.join(', '))
    return res.status(503).json({
      error: `Server misconfigured: missing ${env.missing.join(', ')}`,
    })
  }

  try {
    const client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      // Required for Cloudflare R2 virtual-hosted-style quirks with presigned URLs
      forcePathStyle: true,
    })

    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: fileKey,
    })

    const url = await getSignedUrl(client, command, { expiresIn: 3600 })
    return res.status(200).json({ url })
  } catch (error) {
    console.error('[signed-url] error:', error)
    return res.status(500).json({ error: 'Signed URL failed' })
  }
}
