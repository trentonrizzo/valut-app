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
