import { requireAuthenticatedUser } from './_auth.js'
import { sendJson } from './_json.js'

/**
 * V1.1 does not permanently delete originals.
 * This endpoint remains so old clients get a clear refusal instead of deleting R2 objects.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' })
  }

  try {
    await requireAuthenticatedUser(req)
    return sendJson(res, 403, {
      ok: false,
      error: 'Permanent original deletion is disabled in Vault V1.1',
    })
  } catch (error) {
    const status = error?.statusCode || 500
    return sendJson(res, status, { error: error instanceof Error ? error.message : 'Forbidden' })
  }
}
