import { supabase } from './supabase'
import { addFilesToAlbum } from './albumMembership'
import { listAllMatchingFileIds } from './mediaQueries'
import { addTagsToAlbums } from './tags'
import { addLinkToAlbum, listLinks } from './links'
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
      .insert({ user_id: userId, name, order_index: 0 })
      .select('id, name')
      .single()
    if (error || !data) throw new Error(error?.message || 'Could not create smart album')
    await addTagsToAlbums(userId, [data.id], [input.tagId])
    const marked = await supabase.from('albums').update({ smart_tag_id: input.tagId }).eq('id', data.id).eq('user_id', userId)
    if (marked.error && !/smart_tag_id|schema cache|column/i.test(marked.error.message)) {
      throw new Error(marked.error.message)
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
  const links = await listLinks(userId, { tagIds: [input.tagId], tagMode: 'or' })
  for (const link of links) await addLinkToAlbum(userId, data.id, link.id)
  return { id: data.id, name: data.name, mode: 'normal', added: fileIds.length + links.length }
}
