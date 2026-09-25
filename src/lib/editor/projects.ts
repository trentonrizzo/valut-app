import { supabase } from './../supabase'

export type EditorLayout = '1' | '1x2' | '2x1' | '1+2' | '2x2'

export type EditorLayer = {
  id: string
  fileId: string | null
  kind: 'image' | 'video' | 'empty'
  trimStart: number
  trimEnd: number | null
  /** Photo on-screen duration in seconds (ignored for video length). */
  photoDuration: number
  speed: number
  muted: boolean
  volume: number
  objectFit: 'cover' | 'contain'
  zoom: number
  panX: number
  panY: number
}

export type EditorScene = {
  id: string
  layout: EditorLayout
  layers: EditorLayer[]
}

/** v2 payload — scenes with up to 4 layers each. Legacy v1 slots still accepted. */
export type EditorProjectPayload = {
  version?: 1 | 2
  scenes: EditorScene[]
  activeSceneId: string
  /** Layer id that may play audio (others muted by default). */
  audioMasterLayerId: string | null
  /** @deprecated v1 */
  layout?: EditorLayout
  /** @deprecated v1 */
  slots?: EditorSlotV1[]
  /** @deprecated v1 */
  audioMasterIndex?: number
  multiAudio?: boolean
}

export type EditorSlotV1 = {
  fileId: string | null
  kind: 'image' | 'video' | 'empty'
  trimStart: number
  trimEnd: number | null
  muted: boolean
  objectFit: 'cover' | 'contain'
}

/** @deprecated alias for older imports */
export type EditorSlot = EditorLayer

export type EditorProject = {
  id: string
  user_id: string
  title: string
  kind: 'collage' | 'video'
  payload: EditorProjectPayload
  created_at: string
  updated_at: string
}

export const LAYOUTS: { id: EditorLayout; label: string; count: number }[] = [
  { id: '1', label: 'Full', count: 1 },
  { id: '1x2', label: '2 side', count: 2 },
  { id: '2x1', label: '2 stack', count: 2 },
  { id: '1+2', label: '3', count: 3 },
  { id: '2x2', label: '2×2', count: 4 },
]

function uid() {
  return crypto.randomUUID()
}

export function emptyLayer(): EditorLayer {
  return {
    id: uid(),
    fileId: null,
    kind: 'empty',
    trimStart: 0,
    trimEnd: null,
    photoDuration: 3,
    speed: 1,
    muted: true,
    volume: 1,
    objectFit: 'cover',
    zoom: 1,
    panX: 0,
    panY: 0,
  }
}

export function layersForLayout(layout: EditorLayout, keep: EditorLayer[] = []): EditorLayer[] {
  const count = LAYOUTS.find((l) => l.id === layout)?.count ?? 1
  return Array.from({ length: count }, (_, i) => keep[i] ?? emptyLayer())
}

export function emptyScene(layout: EditorLayout = '1'): EditorScene {
  return { id: uid(), layout, layers: layersForLayout(layout) }
}

export function emptyPayload(layout: EditorLayout = '1'): EditorProjectPayload {
  const scene = emptyScene(layout)
  return {
    version: 2,
    scenes: [scene],
    activeSceneId: scene.id,
    audioMasterLayerId: null,
  }
}

export function normalizePayload(raw: EditorProjectPayload | Record<string, unknown> | null | undefined): EditorProjectPayload {
  if (!raw || typeof raw !== 'object') return emptyPayload()
  const p = raw as EditorProjectPayload
  if (Array.isArray(p.scenes) && p.scenes.length > 0) {
    const scenes = p.scenes.map((s) => ({
      id: s.id || uid(),
      layout: s.layout || '1',
      layers: (s.layers?.length ? s.layers : layersForLayout(s.layout || '1')).map((layer) => ({
        ...emptyLayer(),
        ...layer,
        id: layer.id || uid(),
        photoDuration: layer.photoDuration ?? 3,
        speed: layer.speed ?? 1,
        volume: layer.volume ?? 1,
        zoom: layer.zoom ?? 1,
        panX: layer.panX ?? 0,
        panY: layer.panY ?? 0,
      })),
    }))
    return {
      version: 2,
      scenes,
      activeSceneId: scenes.some((s) => s.id === p.activeSceneId) ? p.activeSceneId : scenes[0]!.id,
      audioMasterLayerId: p.audioMasterLayerId ?? null,
      multiAudio: Boolean(p.multiAudio),
    }
  }
  // Migrate v1 slots → single scene
  const layout = (p.layout || '1') as EditorLayout
  const slots = Array.isArray(p.slots) ? p.slots : []
  const layers = layersForLayout(layout).map((layer, i) => {
    const s = slots[i]
    if (!s) return layer
    return {
      ...layer,
      fileId: s.fileId,
      kind: s.kind,
      trimStart: s.trimStart ?? 0,
      trimEnd: s.trimEnd ?? null,
      muted: s.muted ?? true,
      objectFit: s.objectFit ?? 'cover',
    }
  })
  const scene: EditorScene = { id: uid(), layout, layers }
  const master = typeof p.audioMasterIndex === 'number' ? layers[p.audioMasterIndex]?.id ?? null : null
  return {
    version: 2,
    scenes: [scene],
    activeSceneId: scene.id,
    audioMasterLayerId: master,
    multiAudio: Boolean(p.multiAudio),
  }
}

export function activeScene(payload: EditorProjectPayload): EditorScene {
  return payload.scenes.find((s) => s.id === payload.activeSceneId) ?? payload.scenes[0]!
}

export function projectMediaCount(payload: EditorProjectPayload): number {
  return payload.scenes.reduce((n, s) => n + s.layers.filter((l) => l.fileId).length, 0)
}

export function projectDurationSec(payload: EditorProjectPayload): number {
  return payload.scenes.reduce((sum, scene) => {
    const layerDurations = scene.layers
      .filter((l) => l.fileId)
      .map((l) => {
        if (l.kind === 'image') return Math.max(0.5, l.photoDuration)
        const trim = Math.max(0, (l.trimEnd ?? 0) - l.trimStart)
        const base = trim > 0 ? trim : 5
        return base / Math.max(0.25, l.speed || 1)
      })
    return sum + (layerDurations.length ? Math.max(...layerDurations) : 0)
  }, 0)
}

export async function listEditorProjects(userId: string): Promise<EditorProject[]> {
  const { data, error } = await supabase
    .from('editor_projects')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data as EditorProject[]) ?? []).map((p) => ({
    ...p,
    payload: normalizePayload(p.payload),
  }))
}

export async function saveEditorProject(
  userId: string,
  input: { id?: string; title: string; kind: 'collage' | 'video'; payload: EditorProjectPayload },
): Promise<EditorProject> {
  const payload = normalizePayload(input.payload)
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
    payload: payload as unknown as Record<string, unknown>,
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
    return { ...(data as unknown as EditorProject), payload }
  }
  const { data, error } = await supabase.from('editor_projects').insert(row).select().single()
  if (error) throw new Error(error.message)
  return { ...(data as unknown as EditorProject), payload }
}

export async function deleteEditorProject(userId: string, id: string) {
  const { error } = await supabase.from('editor_projects').delete().eq('id', id).eq('user_id', userId)
  if (error) throw new Error(error.message)
}

export async function duplicateEditorProject(userId: string, project: EditorProject): Promise<EditorProject> {
  return saveEditorProject(userId, {
    title: `${project.title} copy`,
    kind: project.kind,
    payload: normalizePayload(project.payload),
  })
}

export function exportSupported(): { mediaRecorder: boolean; canvas: boolean } {
  return {
    mediaRecorder: typeof MediaRecorder !== 'undefined',
    canvas: typeof document !== 'undefined' && Boolean(document.createElement('canvas').getContext),
  }
}

export function inferProjectKind(payload: EditorProjectPayload): 'collage' | 'video' {
  const layers = payload.scenes.flatMap((s) => s.layers).filter((l) => l.fileId)
  if (layers.length === 1 && layers[0]?.kind === 'video') return 'video'
  if (layers.some((l) => l.kind === 'video')) return 'video'
  return 'collage'
}
