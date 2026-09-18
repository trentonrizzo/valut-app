import { GetBucketCorsCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3'
import { getBucket, getR2Client } from './_s3.js'

const REQUIRED_ORIGINS = [
  'https://vault-app-sigma.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
]

const RULE = {
  AllowedOrigins: ['*', ...REQUIRED_ORIGINS],
  AllowedMethods: ['GET', 'PUT', 'HEAD'],
  AllowedHeaders: ['*'],
  ExposeHeaders: ['ETag', 'etag', 'Content-Length', 'Content-Type', 'x-amz-request-id'],
  MaxAgeSeconds: 86400,
}

let applied = false
let lastError = null

export function getCorsLastError() {
  return lastError
}

export async function ensureBrowserUploadCors() {
  if (applied) return { ok: true, skipped: true }
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
          CORSConfiguration: { CORSRules: [RULE] },
        }),
      )
    }
    applied = true
    lastError = null
    return { ok: true, updated: needsPut }
  } catch (error) {
    lastError = error instanceof Error ? error.message : 'CORS update failed'
    return { ok: false, error: lastError }
  }
}
