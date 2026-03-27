import { createClient } from '@supabase/supabase-js'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { requireAuthenticatedUser } from '../_auth.js'
import { getSupabaseServerEnv } from '../_env.js'
import { r2Client } from '../../lib/r2Client.js'

function extractKeyFromStoredUrl(stored) {
  if (!stored || typeof stored !== 'string') return null
  const s = stored.trim()
  if (!s || s.startsWith('blob:')) return null
  if (!/^https?:\/\//i.test(s)) return s.replace(/^\/+/, '')
  try {
    const u = new URL(s)
    return u.pathname.replace(/^\/+/, '')
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  try {
    const { user, accessToken } = await requireAuthenticatedUser(req)
    const fileId = typeof req.query?.fileId === 'string' ? req.query.fileId : null
    if (!fileId) {
      return res.status(400).json({ ok: false, error: 'fileId is required' })
    }

    const { url: supabaseUrl, anonKey } = getSupabaseServerEnv()
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    })

    const { data: row, error } = await supabase
      .from('files')
      .select('file_url')
      .eq('id', fileId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (error || !row?.file_url) {
      return res.status(403).json({ ok: false, error: 'Not found or access denied' })
    }

    const key = extractKeyFromStoredUrl(row.file_url)
    if (!key) {
      return res.status(400).json({ ok: false, error: 'Invalid file reference' })
    }

    const bucket = process.env.R2_BUCKET_NAME || process.env.R2_BUCKET || 'vault-storage'
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })

    const signedUrl = await getSignedUrl(r2Client, command, { expiresIn: 3600 })
    return res.status(200).json({ ok: true, url: signedUrl })
  } catch (err) {
    const status = err.statusCode || 500
    console.error(err)
    return res.status(status).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Server error',
    })
  }
}
