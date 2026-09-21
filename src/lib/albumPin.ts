import { supabase } from './supabase'

function key(albumId: string) {
  return `vault-album-unlock:${albumId}`
}

export async function setAlbumPassword(albumId: string, password: string): Promise<void> {
  const { error } = await supabase.rpc('set_album_password', { p_album_id: albumId, p_password: password })
  if (error) throw new Error(error.message)
  sessionStorage.setItem(key(albumId), '1')
}

export async function verifyAlbumPassword(albumId: string, password: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('verify_album_password', {
    p_album_id: albumId,
    p_password: password,
  })
  if (error) throw new Error(error.message)
  const ok = data === true
  if (ok) sessionStorage.setItem(key(albumId), '1')
  return ok
}

export async function clearAlbumPassword(albumId: string): Promise<void> {
  const { error } = await supabase.rpc('clear_album_password', { p_album_id: albumId })
  if (error) throw new Error(error.message)
  sessionStorage.removeItem(key(albumId))
}

export function isAlbumUnlocked(albumId: string): boolean {
  try {
    return sessionStorage.getItem(key(albumId)) === '1'
  } catch {
    return false
  }
}

export function lockAlbumSession(albumId: string): void {
  try {
    sessionStorage.removeItem(key(albumId))
  } catch {
    /* ignore */
  }
}

export function albumViewAllowed(album: { id: string; is_protected?: boolean | null; isProtected?: boolean }): boolean {
  const protectedAlbum = album.is_protected === true || album.isProtected === true
  if (!protectedAlbum) return true
  return isAlbumUnlocked(album.id)
}
