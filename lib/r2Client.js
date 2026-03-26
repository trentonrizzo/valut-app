import { S3Client } from '@aws-sdk/client-s3'
import { requireEnv } from '../api/_env.js'

const endpoint = requireEnv('R2_ENDPOINT')
const accessKeyId = requireEnv('R2_ACCESS_KEY_ID')
const secretAccessKey = requireEnv('R2_SECRET_ACCESS_KEY')

export const r2Client = new S3Client({
  region: 'auto',
  endpoint,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
})
