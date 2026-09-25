/**
 * First-class saved links / URLs (vault_links). Soft-fails if migration not applied.
 */
// @ts-nocheck — vault_links lands before generated Database types refresh.
import { supabase } from './supabase'

export type VaultLink = {
  id: string
  user_id: string
  url: string
  domain: string | null
  title: string | null
  notes: string | null
  preview_image_url: string | null
  favorite: boolean
  created_at: string
  updated_at: string
  imported_at: string
}

function domainFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

export async function listLinks(userId: string): Promise<VaultLink[]> {
  const { data, error } = await supabase
    .from('vault_links')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) {
    if (/relation|does not exist|schema cache/i.test(error.message)) return []
    throw new Error(error.message)
  }
  return (data || []) as VaultLink[]
}

export async function createLink(
  userId: string,
  input: { url: string; title?: string; notes?: string },
): Promise<VaultLink> {
  let url = input.url.trim()
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  const row = {
    user_id: userId,
    url,
    domain: domainFromUrl(url),
    title: input.title?.trim() || null,
    notes: input.notes?.trim() || null,
  }
  const { data, error } = await supabase.from('vault_links').insert(row).select('*').single()
  if (error) throw new Error(error.message)
  return data as VaultLink
}

export async function updateLink(
  userId: string,
  id: string,
  patch: Partial<Pick<VaultLink, 'url' | 'title' | 'notes' | 'favorite'>>,
): Promise<void> {
  const next: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() }
  if (patch.url) {
    let url = patch.url.trim()
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`
    next.url = url
    next.domain = domainFromUrl(url)
  }
  const { error } = await supabase.from('vault_links').update(next).eq('id', id).eq('user_id', userId)
  if (error) throw new Error(error.message)
}

export async function deleteLink(userId: string, id: string): Promise<void> {
  const { error } = await supabase.from('vault_links').delete().eq('id', id).eq('user_id', userId)
  if (error) throw new Error(error.message)
}

export async function addLinkToAlbum(userId: string, albumId: string, linkId: string): Promise<void> {
  const { error } = await supabase.from('album_links').upsert(
    { user_id: userId, album_id: albumId, link_id: linkId },
    { onConflict: 'album_id,link_id' },
  )
  if (error) throw new Error(error.message)
}

export async function relateLinkToFile(userId: string, linkId: string, fileId: string): Promise<void> {
  const { error } = await supabase.from('link_files').upsert(
    { user_id: userId, link_id: linkId, file_id: fileId },
    { onConflict: 'link_id,file_id' },
  )
  if (error) throw new Error(error.message)
}
