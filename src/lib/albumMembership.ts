import { supabase } from './supabase'

/** Membership only. Never deletes files or R2 objects. */
export async function addFilesToAlbum(userId: string, albumId: string, fileIds: string[]) {
  if (fileIds.length === 0) return
  const rows = fileIds.map((file_id) => ({ user_id: userId, album_id: albumId, file_id }))
  const { error } = await supabase.from('album_files').upsert(rows, { onConflict: 'album_id,file_id' })
  if (error) throw new Error(error.message)
}

export async function removeFilesFromAlbum(userId: string, albumId: string, fileIds: string[]) {
  if (fileIds.length === 0) return
  const { error } = await supabase
    .from('album_files')
    .delete()
    .eq('user_id', userId)
    .eq('album_id', albumId)
    .in('file_id', fileIds)
  if (error) throw new Error(error.message)
}

export async function moveFilesToAlbum(userId: string, fromAlbumId: string, toAlbumId: string, fileIds: string[]) {
  if (fromAlbumId === toAlbumId) return
  await addFilesToAlbum(userId, toAlbumId, fileIds)
  await removeFilesFromAlbum(userId, fromAlbumId, fileIds)
}

export async function setFavorite(userId: string, fileIds: string[], favorite: boolean) {
  const { error } = await supabase.from('files').update({ favorite }).eq('user_id', userId).in('id', fileIds)
  if (error) throw new Error(error.message)
}

export async function setRating(userId: string, fileIds: string[], rating: number | null) {
  const { error } = await supabase.from('files').update({ rating }).eq('user_id', userId).in('id', fileIds)
  if (error) throw new Error(error.message)
}

/** Albums that currently include this file (canonical membership). */
export async function listAlbumMembershipsForFile(
  userId: string,
  fileId: string,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from('album_files')
    .select('album_id, albums(id, name)')
    .eq('user_id', userId)
    .eq('file_id', fileId)
  if (error) throw new Error(error.message)
  return (data ?? [])
    .map((row) => {
      const album = row.albums as unknown
      if (album && typeof album === 'object' && 'id' in album && 'name' in album) {
        return { id: String((album as { id: string }).id), name: String((album as { name: string }).name) }
      }
      return null
    })
    .filter((a): a is { id: string; name: string } => a != null)
}
