import type { EditorProjectPayload } from './projects'

export type ProjectDocument = { id: string; title: string; payload: EditorProjectPayload }
export type SaveStatus = 'Saved' | 'Saving' | 'Offline draft' | 'Save failed'
export type Draft = { document: ProjectDocument; baseUpdatedAt: string | null; dirty: boolean }
export type SaveResult = { updatedAt: string }
export type PersistencePorts = {
  save: (document: ProjectDocument, expected: string | null) => Promise<SaveResult>
  store: (draft: Draft) => void
  online: () => boolean
}

/** One writer per user/project. Route lifetimes never own or cancel an in-flight save. */
export class ProjectWriter {
  private listeners = new Set<() => void>()
  private running: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  draft: Draft
  status: SaveStatus
  error: string | null = null
  constructor(draft: Draft, private ports: PersistencePorts) {
    this.draft = structuredClone(draft)
    this.status = draft.dirty ? 'Offline draft' : 'Saved'
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit() { this.listeners.forEach((listener) => listener()) }
  edit(document: ProjectDocument) {
    this.generation++
    this.draft = { ...this.draft, document: structuredClone(document), dirty: true }
    try {
      // Synchronous journal precedes navigation and the debounce timer.
      this.ports.store(this.draft)
      this.error = null
      this.status = this.ports.online() ? 'Saving' : 'Offline draft'
    } catch {
      this.error = 'Local draft could not be stored. Keep this page open and retry saving.'
      this.status = 'Save failed'
    }
    this.emit()
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.flush() }, 600)
  }
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.running) return this.running
    if (!this.draft.dirty) return Promise.resolve()
    if (!this.ports.online()) { this.status = 'Offline draft'; this.emit(); return Promise.resolve() }
    this.running = this.drain().finally(() => { this.running = null })
    return this.running
  }
  private async drain() {
    while (this.draft.dirty) {
      const snapshot = structuredClone(this.draft)
      const generation = this.generation
      this.status = 'Saving'; this.emit()
      try {
        const saved = await this.ports.save(snapshot.document, snapshot.baseUpdatedAt)
        this.draft = { ...this.draft, baseUpdatedAt: saved.updatedAt, dirty: generation !== this.generation }
        this.ports.store(this.draft)
        this.error = null
        this.status = this.draft.dirty ? 'Saving' : 'Saved'
        this.emit()
      } catch (e) {
        this.draft = { ...this.draft, dirty: true }
        this.status = this.ports.online() ? 'Save failed' : 'Offline draft'
        this.error = e instanceof Error ? e.message : 'Could not save project. Your local draft is retained.'
        this.emit()
        return
      }
    }
  }
}

export function draftKey(userId: string, projectId: string) { return `vault-editor-draft-v1:${userId}:${projectId}` }
export function readDraft(userId: string, projectId: string): Draft | null {
  const raw = localStorage.getItem(draftKey(userId, projectId))
  if (!raw) return null
  const draft = JSON.parse(raw) as Draft
  if (draft.document?.id !== projectId || !draft.document?.payload) throw new Error('Local draft is unreadable; it has been preserved. Do not clear browser storage.')
  return draft
}
export function storeDraft(userId: string, draft: Draft) {
  localStorage.setItem(draftKey(userId, draft.document.id), JSON.stringify(draft))
}
