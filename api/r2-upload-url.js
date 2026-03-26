import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { requireEnv } from './_env.js'
import { sendJson, readJsonBody } from './_json.js'
import { r2Client } from '../lib/r2Client.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' })
  }

  try {
    const body =
      req.body && typeof req.body === 'object' && req.body !== null
        ? req.body
        : await readJsonBody(req)

    if (!body?.fileName) {
      return sendJson(res, 400, { error: 'fileName is required' })
    }

    const fileName = `${Date.now()}-${body.fileName}`
    const bucket = requireEnv('R2_BUCKET_NAME')
    const publicDomain = requireEnv('R2_PUBLIC_URL').replace(/\/+$/, '')

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: fileName,
      ContentType: body.contentType || 'application/octet-stream',
    })

    const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 300 })

    return sendJson(res, 200, {
      uploadUrl,
      fileUrl: `${publicDomain}/${fileName}`,
    })
  } catch (error) {
    console.error('R2 UPLOAD URL ERROR:', error)
    return sendJson(res, 400, {
      error: error instanceof Error ? error.message : 'Failed to create upload URL',
    })
  }
}
