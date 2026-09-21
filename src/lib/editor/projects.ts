import { supabase } from './../supabase'

export type EditorSlot = {
  fileId: string | null
  kind: 'image' | 'video' | 'empty'
  trimStart: number
  trimEnd: number | null
  muted: boolean
  objectFit: 'cover' | 'contain'
}

export type EditorProjectPayload = {
  layout: '1' | '1x2' | '2x1' | '1+2' | '2x2'
  slots: EditorSlot[]
  audioMasterIndex: number
  multiAudio: boolean
}

export type EditorProject = {
  id: string
  user_id: string
  title: string
  kind: 'collage' | 'video'
  payload: EditorProjectPayload
  created_at: string
  updated_at: string
}

export function emptyPayload(layout: EditorProjectPayload['layout'] = '1'): EditorProjectPayload {
  const count = layout === '1' ? 1 : layout === '2x2' ? 4 : layout === '1+2' ? 3 : 2
  return {
    layout,
    audioMasterIndex: 0,
    multiAudio: false,
    slots: Array.from({ length: count }, () => ({
      fileId: null,
      kind: 'empty',
      trimStart: 0,
      trimEnd: null,
      muted: true,
      objectFit: 'cover',
    })),
  }
}

export async function listEditorProjects(userId: string): Promise<EditorProject[]> {
  const { data, error } = await supabase
    .from('editor_projects')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data as EditorProject[]) ?? []
}

export async function saveEditorProject(
  userId: string,
  input: { id?: string; title: string; kind: 'collage' | 'video'; payload: EditorProjectPayload },
): Promise<EditorProject> {
  const row: {
    user_id: string
    title: string
    kind: string
    payload: Record<string, unknown>
    updated_at: string
  } = {
    user_id: userId,
    title: input.title,
    kind: input.kind,
    payload: input.payload as unknown as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  }
  if (input.id) {
    const { data, error } = await supabase
      .from('editor_projects')
      .update(row)
      .eq('id', input.id)
      .eq('user_id', userId)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data as unknown as EditorProject
  }
  const { data, error } = await supabase.from('editor_projects').insert(row).select().single()
  if (error) throw new Error(error.message)
  return data as unknown as EditorProject
}

export async function deleteEditorProject(userId: string, id: string) {
  const { error } = await supabase.from('editor_projects').delete().eq('id', id).eq('user_id', userId)
  if (error) throw new Error(error.message)
}

export function exportSupported(): { mediaRecorder: boolean; canvas: boolean } {
  return {
    mediaRecorder: typeof MediaRecorder !== 'undefined',
    canvas: typeof document !== 'undefined' && Boolean(document.createElement('canvas').getContext),
  }
}
