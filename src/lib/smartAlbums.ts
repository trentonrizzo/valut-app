import { supabase } from './supabase'
import { addFilesToAlbum } from './albumMembership'
import { listAllMatchingFileIds } from './mediaQueries'
import { DEFAULT_MEDIA_FILTERS } from '../types/media'

export type GroupAlbumMode = 'normal' | 'smart'

/**
 * Normal albums copy memberships only.
 * Smart albums store the tag id and keep showing every file with that tag.
 * Neither copies media or removes older album memberships.
 */
export async function createAlbumFromGroup(
  userId: string,
  input: { name: string; tagId: string; mode: GroupAlbumMode },
): Promise<{ id: string; name: string; mode: GroupAlbumMode; added: number }> {
  const name = input.name.trim()
  if (!name) throw new Error('Enter an album name.')
  if (!input.tagId) throw new Error('Choose a group first.')

  if (input.mode === 'smart') {
    const { data, error } = await supabase
      .from('albums')
      .insert({ user_id: userId, name, order_index: 0, smart_tag_id: input.tagId })
      .select('id, name')
      .single()
    if (error || !data) {
      if (error && /smart_tag_id|schema cache|column/i.test(error.message)) {
        throw new Error('Smart albums need the database update before they can stay in sync.')
      }
      throw new Error(error?.message || 'Could not create smart album')
    }
    return { id: data.id, name: data.name, mode: 'smart', added: 0 }
  }

  const { data, error } = await supabase
    .from('albums')
    .insert({ user_id: userId, name, order_index: 0 })
    .select('id, name')
    .single()
  if (error || !data) throw new Error(error?.message || 'Could not create album')
  const fileIds = await listAllMatchingFileIds({
    userId,
    filters: { ...DEFAULT_MEDIA_FILTERS, tagIds: [input.tagId], tagMode: 'and' },
  })
  await addFilesToAlbum(userId, data.id, fileIds)
  return { id: data.id, name: data.name, mode: 'normal', added: fileIds.length }
}
