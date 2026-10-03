/** First-class saved links. URLs never leave Supabase for preview/metadata services. */
import { supabase } from './supabase'
import { displayDomain, normalizeSafeHttpUrl, type ParsedLink } from './linkParser'

export type VaultLink = {
  id: string
  user_id: string
  url: string
  domain: string | null
  title: string | null
  notes: string | null
  preview_image_url: string | null
  favorite: boolean
  rating: number | null
  locked: boolean
  deleted_at: string | null
  membership_snapshot: unknown
  created_at: string
  updated_at: string
  imported_at: string
}

export type LinkImportResult = { created: VaultLink[]; failed: { url: string; error: string }[]; skippedExisting: number }

export async function listLinks(
  userId: string,
  options: { includeDeleted?: boolean; search?: string; favorite?: boolean; albumId?: string | null; tagIds?: string[]; tagMode?: 'and' | 'or' } = {},
): Promise<VaultLink[]> {
  let q = supabase.from('vault_links').select('*').eq('user_id', userId)
  q = options.includeDeleted ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null)
  if (options.favorite != null) q = q.eq('favorite', options.favorite)
  if (options.search?.trim()) {
    const term = options.search.trim().replace(/[%(),]/g, ' ').slice(0, 100)
    q = q.or(`title.ilike.%${term}%,domain.ilike.%${term}%,url.ilike.%${term}%,notes.ilike.%${term}%`)
  }
  if (options.albumId) {
    const { data } = await supabase.from('album_links').select('link_id').eq('user_id', userId).eq('album_id', options.albumId)
    const ids = (data ?? []).map((row) => row.link_id)
    if (!ids.length) return []
    q = q.in('id', ids)
  }
  if (options.tagIds?.length) {
    const { data } = await supabase.from('link_tags').select('link_id,tag_id').eq('user_id', userId).in('tag_id', options.tagIds)
    const byLink = new Map<string, Set<string>>()
    for (const row of data ?? []) {
      const set = byLink.get(row.link_id) ?? new Set<string>()
      set.add(row.tag_id)
      byLink.set(row.link_id, set)
    }
    const ids = [...byLink.entries()].filter(([, set]) => options.tagMode === 'or' ? set.size > 0 : options.tagIds!.every((id) => set.has(id))).map(([id]) => id)
    if (!ids.length) return []
    q = q.in('id', ids)
  }
  const { data, error } = await q.order('created_at', { ascending: false }).limit(1000)
  if (error) {
    if (/relation|does not exist|schema cache/i.test(error.message)) return []
    throw new Error(error.message)
  }
  return (data || []) as VaultLink[]
}

export async function createLink(userId: string, input: { url: string; title?: string; notes?: string }): Promise<VaultLink> {
  const url = normalizeSafeHttpUrl(input.url)
  if (!url) throw new Error('Only valid http:// or https:// links can be saved.')
  const row = { user_id: userId, url, domain: displayDomain(url), title: input.title?.trim() || null, notes: input.notes?.trim() || null }
  const { data, error } = await supabase.from('vault_links').insert(row).select('*').single()
  if (error) throw new Error(error.message)
  return data as VaultLink
}

export async function importLinks(userId: string, rows: ParsedLink[], options: { albumId?: string | null; tagIds?: string[]; importExistingDuplicates?: boolean }): Promise<LinkImportResult> {
  const created: VaultLink[] = []
  const failed: { url: string; error: string }[] = []
  let skippedExisting = 0
  const existing = new Set<string>()
  if (!options.importExistingDuplicates) {
    for (let i = 0; i < rows.length; i += 40) {
      const urls = rows.slice(i, i + 40).map((row) => row.url)
      const { data } = await supabase.from('vault_links').select('url').eq('user_id', userId).in('url', urls)
      for (const row of data ?? []) existing.add(row.url)
    }
  }
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    if (existing.has(row.url)) { skippedExisting += 1; continue }
    try {
      const link = await createLink(userId, { url: row.url, title: row.title })
      if (options.albumId) await addLinkToAlbum(userId, options.albumId, link.id)
      if (options.tagIds?.length) await addTagsToLinks(userId, [link.id], options.tagIds)
      created.push(link)
    } catch (error) {
      failed.push({ url: row.url, error: error instanceof Error ? error.message : 'Import failed' })
    }
    if ((i + 1) % 10 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  return { created, failed, skippedExisting }
}

export async function updateLink(userId: string, id: string, patch: Partial<Pick<VaultLink, 'url' | 'title' | 'notes' | 'favorite' | 'rating' | 'locked'>>): Promise<void> {
  const next: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() }
  if (patch.url != null) {
    const url = normalizeSafeHttpUrl(patch.url)
    if (!url) throw new Error('Only valid http:// or https:// links can be saved.')
    next.url = url
    next.domain = displayDomain(url)
  }
  const { error } = await supabase.from('vault_links').update(next).eq('id', id).eq('user_id', userId)
  if (error) throw new Error(error.message)
}

export async function addLinkToAlbum(userId: string, albumId: string, linkId: string): Promise<void> {
  const { error } = await supabase.from('album_links').upsert({ user_id: userId, album_id: albumId, link_id: linkId }, { onConflict: 'album_id,link_id', ignoreDuplicates: true })
  if (error) throw new Error(error.message)
}
export async function removeLinksFromAlbum(userId: string, albumId: string, linkIds: string[]): Promise<void> {
  if (!linkIds.length) return
  const { error } = await supabase.from('album_links').delete().eq('user_id', userId).eq('album_id', albumId).in('link_id', linkIds)
  if (error) throw new Error(error.message)
}
export async function addTagsToLinks(userId: string, linkIds: string[], tagIds: string[]): Promise<void> {
  const rows = linkIds.flatMap((link_id) => tagIds.map((tag_id) => ({ user_id: userId, link_id, tag_id })))
  if (!rows.length) return
  const { error } = await supabase.from('link_tags').upsert(rows, { onConflict: 'link_id,tag_id', ignoreDuplicates: true })
  if (error) throw new Error(error.message)
}
export async function removeTagsFromLinks(userId: string, linkIds: string[], tagIds: string[]): Promise<void> {
  if (!linkIds.length || !tagIds.length) return
  const { error } = await supabase.from('link_tags').delete().eq('user_id', userId).in('link_id', linkIds).in('tag_id', tagIds)
  if (error) throw new Error(error.message)
}
export async function softDeleteLinks(userId: string, linkIds: string[]): Promise<void> {
  for (const id of linkIds) {
    const { data, error } = await supabase.from('album_links').select('album_id').eq('user_id', userId).eq('link_id', id)
    if (error) throw new Error(error.message)
    const snapshot = (data ?? []).map((row) => row.album_id)
    const { error: updateError } = await supabase.from('vault_links').update({ deleted_at: new Date().toISOString(), membership_snapshot: snapshot, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('id', id)
    if (updateError) throw new Error(updateError.message)
  }
  const { error } = await supabase.from('album_links').delete().eq('user_id', userId).in('link_id', linkIds)
  if (error) throw new Error(error.message)
}
export async function restoreLinks(userId: string, linkIds: string[]): Promise<void> {
  const { data, error } = await supabase.from('vault_links').select('id,membership_snapshot').eq('user_id', userId).in('id', linkIds)
  if (error) throw new Error(error.message)
  for (const row of data ?? []) {
    const albums = Array.isArray(row.membership_snapshot) ? row.membership_snapshot.filter((id): id is string => typeof id === 'string') : []
    for (const albumId of albums) await addLinkToAlbum(userId, albumId, row.id)
    const { error: clearError } = await supabase.from('vault_links').update({ deleted_at: null, membership_snapshot: [], updated_at: new Date().toISOString() }).eq('user_id', userId).eq('id', row.id)
    if (clearError) throw new Error(clearError.message)
  }
}
export async function permanentlyDeleteLinks(userId: string, linkIds: string[]): Promise<void> {
  if (!linkIds.length) return
  const { error } = await supabase.from('vault_links').delete().eq('user_id', userId).in('id', linkIds).not('deleted_at', 'is', null)
  if (error) throw new Error(error.message)
}
export async function relateLinkToFile(userId: string, linkId: string, fileId: string): Promise<void> {
  const { error } = await supabase.from('link_files').upsert({ user_id: userId, link_id: linkId, file_id: fileId }, { onConflict: 'link_id,file_id', ignoreDuplicates: true })
  if (error) throw new Error(error.message)
}
