import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3'

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

const CORS_RULE = {
  AllowedOrigins: ['*', 'https://vault-app-sigma.vercel.app', 'http://localhost:5173', 'http://localhost:3000'],
  AllowedMethods: ['GET', 'PUT', 'HEAD'],
  AllowedHeaders: ['*'],
  ExposeHeaders: ['ETag', 'etag', 'Content-Length', 'Content-Type', 'x-amz-request-id'],
  MaxAgeSeconds: 86400,
}

let corsApplied = false

export async function ensureBrowserUploadCors() {
  if (corsApplied) return { ok: true, skipped: true }
  try {
    const client = getR2Client()
    const bucket = getBucket()
    let needsPut = true
    try {
      const current = await client.send(new GetBucketCorsCommand({ Bucket: bucket }))
      const rules = current.CORSRules || []
      needsPut = !rules.some((r) => {
        const expose = (r.ExposeHeaders || []).map((h) => String(h).toLowerCase())
        const methods = (r.AllowedMethods || []).map((m) => String(m).toUpperCase())
        return expose.includes('etag') && methods.includes('PUT') && methods.includes('GET')
      })
    } catch {
      needsPut = true
    }
    if (needsPut) {
      await client.send(
        new PutBucketCorsCommand({
          Bucket: bucket,
          CORSConfiguration: { CORSRules: [CORS_RULE] },
        }),
      )
    }
    corsApplied = true
    return { ok: true, updated: needsPut }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'CORS update failed' }
  }
}
