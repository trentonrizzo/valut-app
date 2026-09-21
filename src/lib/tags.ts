import { supabase } from './supabase'

export function normalizeTagName(name: string): { name: string; name_normalized: string } {
  const trimmed = name.trim().replace(/\s+/g, ' ')
  return { name: trimmed, name_normalized: trimmed.toLowerCase() }
}

export async function listTags(userId: string) {
  const { data, error } = await supabase
    .from('tags')
    .select('*')
    .eq('user_id', userId)
    .order('name_normalized', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function createTag(userId: string, rawName: string) {
  const { name, name_normalized } = normalizeTagName(rawName)
  if (!name) throw new Error('Enter a tag name.')
  const { data, error } = await supabase
    .from('tags')
    .upsert({ user_id: userId, name, name_normalized }, { onConflict: 'user_id,name_normalized' })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function renameTag(userId: string, tagId: string, rawName: string) {
  const { name, name_normalized } = normalizeTagName(rawName)
  if (!name) throw new Error('Enter a tag name.')
  const { error } = await supabase.from('tags').update({ name, name_normalized }).eq('id', tagId).eq('user_id', userId)
  if (error) throw new Error(error.message)
}

export async function deleteTag(userId: string, tagId: string) {
  const { error } = await supabase.from('tags').delete().eq('id', tagId).eq('user_id', userId)
  if (error) throw new Error(error.message)
}

export async function addTagsToFiles(userId: string, fileIds: string[], tagIds: string[]) {
  const rows = fileIds.flatMap((file_id) => tagIds.map((tag_id) => ({ file_id, tag_id, user_id: userId })))
  if (rows.length === 0) return
  const { error } = await supabase.from('file_tags').upsert(rows, { onConflict: 'file_id,tag_id' })
  if (error) throw new Error(error.message)
}

export async function removeTagsFromFiles(userId: string, fileIds: string[], tagIds: string[]) {
  const { error } = await supabase
    .from('file_tags')
    .delete()
    .eq('user_id', userId)
    .in('file_id', fileIds)
    .in('tag_id', tagIds)
  if (error) throw new Error(error.message)
}

export async function addTagsToAlbums(userId: string, albumIds: string[], tagIds: string[]) {
  const rows = albumIds.flatMap((album_id) => tagIds.map((tag_id) => ({ album_id, tag_id, user_id: userId })))
  if (rows.length === 0) return
  const { error } = await supabase.from('album_tags').upsert(rows, { onConflict: 'album_id,tag_id' })
  if (error) throw new Error(error.message)
}

export async function removeTagsFromAlbums(userId: string, albumIds: string[], tagIds: string[]) {
  const { error } = await supabase
    .from('album_tags')
    .delete()
    .eq('user_id', userId)
    .in('album_id', albumIds)
    .in('tag_id', tagIds)
  if (error) throw new Error(error.message)
}

export async function tagsForAlbum(userId: string, albumId: string) {
  const { data, error } = await supabase
    .from('album_tags')
    .select('tag_id, tags(id, name, name_normalized)')
    .eq('user_id', userId)
    .eq('album_id', albumId)
  if (error) throw new Error(error.message)
  return (data ?? [])
    .map((r) => {
      const t = r.tags as unknown
      if (t && typeof t === 'object' && 'id' in t) return t as { id: string; name: string; name_normalized: string }
      return null
    })
    .filter((t): t is { id: string; name: string; name_normalized: string } => t != null)
}

export async function tagsForFile(userId: string, fileId: string) {
  const { data, error } = await supabase
    .from('file_tags')
    .select('tag_id, tags(id, name, name_normalized)')
    .eq('user_id', userId)
    .eq('file_id', fileId)
  if (error) throw new Error(error.message)
  return (data ?? [])
    .map((r) => {
      const t = r.tags as unknown
      if (t && typeof t === 'object' && 'id' in t) return t as { id: string; name: string; name_normalized: string }
      return null
    })
    .filter((t): t is { id: string; name: string; name_normalized: string } => t != null)
}
