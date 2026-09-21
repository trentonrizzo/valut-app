import { supabase } from './supabase'
import { isVaultSessionUnlocked } from './vaultPin'

export function isFileLocked(file: { locked?: boolean | null }): boolean {
  return file.locked === true
}

export function canRevealLockedContent(file: { locked?: boolean | null }): boolean {
  if (!isFileLocked(file)) return true
  return isVaultSessionUnlocked()
}

export async function setFilesLocked(userId: string, fileIds: string[], locked: boolean) {
  if (fileIds.length === 0) return
  const { error } = await supabase.from('files').update({ locked }).eq('user_id', userId).in('id', fileIds)
  if (error) throw new Error(error.message)
}
