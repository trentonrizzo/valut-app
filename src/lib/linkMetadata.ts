import { supabase } from './supabase'
import type { VaultLink } from './links'

export type ProviderLinkMetadata = {
  provider: string
  automaticTitle: string | null
  providerCreatedAt: string | null
}

export function providerForUrl(raw: string): string | null {
  try {
    const host = new URL(raw).hostname.replace(/^www\./i, '').toLowerCase()
    if (host === 'mega.nz' || host.endsWith('.mega.nz')) return 'MEGA'
    return null
  } catch {
    return null
  }
}

export async function resolveProviderLinkMetadata(accessToken: string, url: string): Promise<ProviderLinkMetadata | null> {
  const response = await fetch('/api/ai', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'link-metadata', url }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.error || `Metadata request failed (${response.status})`)
  if (data?.ok === false) throw new Error(data?.error || 'Provider metadata unavailable')
  if (!data?.metadata) return null
  return {
    provider: String(data.metadata.provider || '').slice(0, 80),
    automaticTitle: typeof data.metadata.automaticTitle === 'string' ? data.metadata.automaticTitle.slice(0, 1000) : null,
    providerCreatedAt: typeof data.metadata.providerCreatedAt === 'string' ? data.metadata.providerCreatedAt : null,
  }
}

async function enrichOne(userId: string, accessToken: string, link: VaultLink): Promise<'resolved' | 'unavailable' | 'failed'> {
  try {
    const metadata = await resolveProviderLinkMetadata(accessToken, link.url)
    const status = metadata?.automaticTitle || metadata?.providerCreatedAt ? 'resolved' : 'unavailable'
    const { error } = await supabase
      .from('vault_links')
      .update({
        provider: metadata?.provider || link.provider || providerForUrl(link.url),
        automatic_title: metadata?.automaticTitle || link.automatic_title || null,
        provider_created_at: metadata?.providerCreatedAt || link.provider_created_at || null,
        metadata_status: status,
        metadata_updated_at: new Date().toISOString(),
      })
      .eq('id', link.id)
      .eq('user_id', userId)
    if (error) throw new Error(error.message)
    return status
  } catch {
    await supabase
      .from('vault_links')
      .update({ metadata_status: 'failed', metadata_updated_at: new Date().toISOString() })
      .eq('id', link.id)
      .eq('user_id', userId)
    return 'failed'
  }
}

export async function enrichLinksMetadata(
  userId: string,
  accessToken: string,
  links: VaultLink[],
  concurrency = 2,
  onProgress?: (completed: number, total: number) => void,
): Promise<{ resolved: number; unavailable: number; failed: number }> {
  const queue = [...links]
  const result = { resolved: 0, unavailable: 0, failed: 0 }
  let completed = 0
  const worker = async () => {
    while (queue.length) {
      const link = queue.shift()
      if (!link) return
      const status = await enrichOne(userId, accessToken, link)
      result[status] += 1
      completed += 1
      onProgress?.(completed, links.length)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(4, concurrency, links.length || 1)) }, () => worker()))
  return result
}

export async function listLinksNeedingMetadata(userId: string, limit = 100): Promise<VaultLink[]> {
  const { data, error } = await supabase
    .from('vault_links')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .is('title', null)
    .or('metadata_status.is.null,metadata_status.eq.pending,metadata_status.eq.failed')
    .order('created_at', { ascending: true })
    .limit(Math.max(1, Math.min(500, limit)))
  if (error) throw new Error(error.message)
  return (data ?? []) as VaultLink[]
}
