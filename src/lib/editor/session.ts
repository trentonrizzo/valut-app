import { getEditorProject, saveProjectDocument } from './projects'
import { ProjectWriter, readDraft, storeDraft, type Draft } from './persistence'

const writers = new Map<string, ProjectWriter>()
export function writerFor(userId: string, draft: Draft) {
  const key = `${userId}:${draft.document.id}`
  let writer = writers.get(key)
  if (!writer) {
    writer = new ProjectWriter(draft, {
      save: (document, expected) => saveProjectDocument(userId, document, expected),
      store: (next) => storeDraft(userId, next),
      online: () => navigator.onLine,
    })
    writers.set(key, writer)
  }
  return writer
}
export async function loadProjectWriter(userId: string, projectId: string) {
  const existing = writers.get(`${userId}:${projectId}`)
  if (existing) return existing
  const local = readDraft(userId, projectId)
  let remote
  try { remote = await getEditorProject(userId, projectId) }
  catch (error) { if (!local) throw error }
  if (!remote && !local) throw new Error('Project not found or unavailable. No new project was created.')
  const draft: Draft = local?.dirty || (!remote && local) ? local! : {
    document: { id: remote!.id, title: remote!.title, payload: remote!.payload },
    baseUpdatedAt: remote!.updated_at, dirty: false,
  }
  return writerFor(userId, draft)
}
