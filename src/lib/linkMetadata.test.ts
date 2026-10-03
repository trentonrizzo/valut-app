import { describe, expect, it, vi } from 'vitest'
import { enrichLinksMetadata, providerForUrl } from './linkMetadata'
import { displayLinkName, type VaultLink } from './links'

vi.mock('./supabase', () => ({
  supabase: { from: () => ({ update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }) },
}))

function link(id: string): VaultLink {
  return {
    id, user_id: 'u', url: `https://example.com/${id}`, domain: 'example.com', title: null,
    automatic_title: null, provider: null, provider_created_at: null, metadata_status: null, metadata_updated_at: null,
    notes: null, preview_image_url: null, favorite: false, rating: null, locked: false, deleted_at: null,
    membership_snapshot: [], created_at: '', updated_at: '', imported_at: '',
  }
}

describe('link provider metadata queue', () => {
  it('recognizes only legitimate MEGA hosts', () => {
    expect(providerForUrl('https://mega.nz/folder/a#b')).toBe('MEGA')
    expect(providerForUrl('https://mega.nz.example.com/folder/a#b')).toBeNull()
  })

  it('always keeps a manual title ahead of an automatic provider title', () => {
    expect(displayLinkName({ title: 'My name', automatic_title: 'Provider name', domain: 'mega.nz' })).toBe('My name')
    expect(displayLinkName({ title: null, automatic_title: 'Provider name', domain: 'mega.nz' })).toBe('Provider name')
  })

  it('bounds 100-link enrichment concurrency', async () => {
    let active = 0
    let peak = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      active += 1; peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active -= 1
      return new Response(JSON.stringify({ ok: true, metadata: null }), { status: 200 })
    }))
    const result = await enrichLinksMetadata('u', 'token', Array.from({ length: 100 }, (_, i) => link(String(i))), 2)
    expect(result.unavailable).toBe(100)
    expect(peak).toBeLessThanOrEqual(2)
  })
})
