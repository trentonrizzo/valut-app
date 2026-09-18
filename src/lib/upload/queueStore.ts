export type UploadUiState =
  | 'queued'
  | 'preparing'
  | 'encrypting'
  | 'uploading'
  | 'paused'
  | 'retrying'
  | 'finalizing'
  | 'complete'
  | 'failed'
  | 'needs-file'

export type PersistedPart = {
  partNumber: number
  etag: string | null
  bytes: number
  done: boolean
  acked?: boolean
}

export type PersistedUploadJob = {
  id: string
  albumId: string | null
  purpose: 'content' | 'cover'
  fileName: string
  size: number
  type: string
  objectId: string
  storageKey: string | null
  uploadId: string | null
  parts: PersistedPart[]
  uploadedBytes: number
  state: UploadUiState
  error: string | null
  encryptionVersion: number
  fileNonceB64: string | null
  wrappedDek: string | null
  chunkSize: number
  width: number | null
  height: number | null
  durationMs: number | null
  capturedAt: string | null
  createdAt: number
  r2Complete?: boolean
  r2Verified?: boolean
  verifiedSize?: number | null
  multipartComplete?: boolean
  dbComplete?: boolean
  albumComplete?: boolean
  errorCode?: string | null
  lastStage?: string | null
  lastModified?: number
}

const DB = 'vault-upload-queue-v11'
const STORE = 'jobs'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('queue idb failed'))
  })
}

export async function saveJob(job: PersistedUploadJob): Promise<void> {
  const db = await open()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.objectStore(STORE).put(job)
    })
  } finally {
    db.close()
  }
}

export async function getJob(id: string): Promise<PersistedUploadJob | undefined> {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(id)
      req.onsuccess = () => resolve(req.result as PersistedUploadJob | undefined)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export async function listJobs(): Promise<PersistedUploadJob[]> {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).getAll()
      req.onsuccess = () => resolve((req.result as PersistedUploadJob[]) ?? [])
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export async function deleteJob(id: string): Promise<void> {
  const db = await open()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.objectStore(STORE).delete(id)
    })
  } finally {
    db.close()
  }
}
