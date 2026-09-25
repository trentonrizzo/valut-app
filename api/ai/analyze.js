/**
 * Server-side visual analysis. Requires OPENAI_API_KEY / VAULT_AI_API_KEY.
 * Never deletes media. Client must scope requests (album/selection).
 */
import { requireAuthenticatedUser } from '../_auth.js'
import { readJsonBody, sendJson } from '../_json.js'

const ANALYSIS_VERSION = '1'

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
      hint: 'Set OPENAI_API_KEY or VAULT_AI_API_KEY for visual analysis. Metadata tools still work.',
      analysisVersion: ANALYSIS_VERSION,
    })
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON' })
  }

  const images = Array.isArray(body?.images) ? body.images.slice(0, 4) : []
  if (!images.length) return sendJson(res, 400, { error: 'images required (data URLs or base64 jpeg)' })

  const focus = String(body?.focus || 'general visual description, approximate people count, hair color if visible, useful searchable descriptors').slice(0, 500)
  const model = process.env.VAULT_AI_VISION_MODEL || process.env.VAULT_AI_MODEL || 'gpt-4.1-mini'

  const content = [
    {
      type: 'text',
      text: `Analyze these Vault media frame(s). Return ONLY compact JSON (no markdown):
{"description":string,"people_count":number|null,"attributes":{"blonde_hair":boolean|null,"two_people":boolean|null,"descriptors":string[]},"person_slots":[{"label":"Person 1","notes":string}],"confidence":number}
Rules: people_count is approximate. Do not invent identities or real names. Use Person 1, Person 2 for slots only. Focus: ${focus}`,
    },
  ]
  for (const img of images) {
    const url = typeof img === 'string' ? img : img?.dataUrl || img?.url
    if (!url || typeof url !== 'string') continue
    content.push({ type: 'image_url', image_url: { url: url.slice(0, 2_500_000) } })
  }
  if (content.length < 2) return sendJson(res, 400, { error: 'No valid images' })

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You analyze private vault media frames. Output JSON only. Never suggest deleting media. Never invent real names.',
          },
          { role: 'user', content },
        ],
      }),
    })
    const data = await response.json()
    if (!response.ok) {
      return sendJson(res, 502, { error: data?.error?.message || 'Vision provider error' })
    }
    const raw = data?.choices?.[0]?.message?.content || '{}'
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = { description: String(raw).slice(0, 2000), people_count: null, attributes: {}, confidence: 0.3 }
    }
    return sendJson(res, 200, {
      ok: true,
      provider: 'openai',
      model,
      analysisVersion: ANALYSIS_VERSION,
      analysis: {
        description: typeof parsed.description === 'string' ? parsed.description.slice(0, 4000) : null,
        people_count: Number.isFinite(Number(parsed.people_count)) ? Number(parsed.people_count) : null,
        attributes: parsed.attributes && typeof parsed.attributes === 'object' ? parsed.attributes : {},
        person_slots: Array.isArray(parsed.person_slots) ? parsed.person_slots.slice(0, 12) : [],
        confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : null,
      },
    })
  } catch (e) {
    return sendJson(res, 500, { error: e instanceof Error ? e.message : 'Vision request failed' })
  }
}
