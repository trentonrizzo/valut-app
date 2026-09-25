import { requireAuthenticatedUser } from '../_auth.js'
import { readJsonBody, sendJson } from '../_json.js'

/**
 * Optional LLM chat. Without OPENAI_API_KEY, returns 503 so the client uses deterministic tools.
 * Never exposes the API key to the browser.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' })

  try {
    await requireAuthenticatedUser(req)
  } catch (e) {
    return sendJson(res, e?.statusCode || 401, { error: e?.message || 'Unauthorized' })
  }

  const key = process.env.OPENAI_API_KEY || process.env.VAULT_AI_API_KEY
  if (!key) {
    return sendJson(res, 503, {
      error: 'AI provider not configured',
      hint: 'Set OPENAI_API_KEY (or VAULT_AI_API_KEY) on the server. Client falls back to metadata tools.',
    })
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON' })
  }

  const prompt = String(body?.prompt || '').slice(0, 4000)
  if (!prompt) return sendJson(res, 400, { error: 'prompt required' })

  const model = process.env.VAULT_AI_MODEL || 'gpt-4.1-mini'
  const system = `You are Vault AI, an assistant inside a private media vault.
You may suggest organizational actions (tags, albums, favorites, duplicates, storage stats, metadata search).
Never instruct permanent deletion, emptying trash, overwriting originals, or wiping databases.
Keep answers concise. If visual analysis is requested and no analysis cache is available, say a vision pass is required and should be scoped to an album or selection.`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      }),
    })
    const data = await response.json()
    if (!response.ok) {
      return sendJson(res, 502, { error: data?.error?.message || 'AI provider error' })
    }
    const reply = data?.choices?.[0]?.message?.content || 'No response.'
    return sendJson(res, 200, { reply, model, provider: 'openai' })
  } catch (e) {
    return sendJson(res, 500, { error: e instanceof Error ? e.message : 'AI request failed' })
  }
}
