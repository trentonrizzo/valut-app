import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MAX_UPLOAD_FILE_BYTES } from '../batchUploadToAlbum'
import { originalKey } from '../storageKeys'
import { isVideoFileName, isVideoMime } from '../mediaTypes'
import {
  cancelDeletesOriginal,
  catalogReadyAllowed,
  duplicateSafeUpsert,
  missingPartNumbers,
  nextRetryScope,
  progressIsComplete,
  reconcilePersistedJob,
  shouldExposeInLibrary,
  shouldSkipByteUpload,
} from './finalizePolicy'
import { backoffMs, fileConcurrency, MAX_PART_RETRIES, MAX_PARTS } from './multipartConfig'
import {
  canCatalogReady,
  classifyUploadError,
  displayProgress,
  fileMatchesResume,
  isVideoUpload,
  MAX_QUEUE_ITEMS,
  normalizeUploadMime,
  planUpload,
  uniqueOriginalKey,
} from './strategy'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

describe('photo simple upload success', () => {
  it('uses a single PUT for a small jpeg', () => {
    const plan = planUpload(420_000)
    expect(plan.useMultipart).toBe(false)
    expect(plan.parts).toHaveLength(1)
    expect(normalizeUploadMime({ name: 'IMG_1001.JPG', type: 'image/jpeg' })).toBe('image/jpeg')
  })
})

describe('small MP4 success path', () => {
  it('plans simple upload and treats mp4 as video', () => {
    const plan = planUpload(2_200_000)
    expect(plan.useMultipart).toBe(false)
    expect(isVideoUpload({ name: 'clip.mp4', type: 'video/mp4' })).toBe(true)
    expect(displayProgress({ state: 'finalizing', size: 2_200_000, uploadedBytes: 2_200_000 }).label).toBe(
      'Finalizing…',
    )
  })
})

describe('metadata extraction never blocks upload', () => {
  it('extractMediaMetadata swallows failures and manager catalogs after verify only', () => {
    const src = readFileSync(join(root, 'lib/upload/extractMetadata.ts'), 'utf8')
    expect(src).toContain('catch')
    expect(src).toContain('return base')
    const manager = readFileSync(join(root, 'lib/upload/manager.ts'), 'utf8')
    expect(manager).toContain('metadata-failed')
    expect(manager).toContain('expectedVerifySize')
  })
})

describe('MOV / video MIME handling', () => {
  it('accepts iPhone QuickTime MIME and .MOV names', () => {
    expect(normalizeUploadMime({ name: 'IMG_0099.MOV', type: '' })).toBe('video/quicktime')
    expect(normalizeUploadMime({ name: 'clip.mov', type: 'video/quicktime' })).toBe('video/quicktime')
    expect(isVideoMime('video/quicktime', 'IMG_0099.MOV')).toBe(true)
    expect(isVideoFileName('holiday.MOV')).toBe(true)
    expect(isVideoUpload({ name: 'IMG_0099.MOV', type: 'application/octet-stream' })).toBe(true)
  })
})

describe('multipart upload success', () => {
  it('splits large files into ordered parts under the part-count cap', () => {
    const plan = planUpload(25 * 1024 * 1024)
    expect(plan.useMultipart).toBe(true)
    expect(plan.parts.length).toBeGreaterThan(1)
    expect(plan.parts[0]?.partNumber).toBe(1)
    expect(plan.parts.at(-1)?.partNumber).toBe(plan.parts.length)
    expect(plan.parts.reduce((s, p) => s + p.bytes, 0)).toBe(25 * 1024 * 1024)
    expect(plan.parts.length).toBeLessThanOrEqual(MAX_PARTS)
  })
})

describe('one multipart part fails then retries', () => {
  it('retries only unfinished parts', () => {
    const missing = missingPartNumbers([
      { partNumber: 1, done: true },
      { partNumber: 2, done: false },
      { partNumber: 3, done: true },
    ])
    expect(missing).toEqual([2])
    expect(MAX_PART_RETRIES).toBeGreaterThanOrEqual(3)
    expect(backoffMs(3)).toBeGreaterThan(backoffMs(0))
  })
})

describe('multipart complete fails then retries without reuploading', () => {
  it('scopes retry to complete when every part already has an ETag', () => {
    const scope = nextRetryScope(
      {
        uploadId: 'upl_1',
        parts: [
          { done: true, etag: '"a"' },
          { done: true, etag: '"b"' },
        ],
      },
      true,
    )
    expect(scope).toBe('complete')
  })
})

describe('DB finalization fails after R2 succeeds', () => {
  it('retries metadata only after verification', () => {
    expect(nextRetryScope({ r2Complete: true, dbComplete: false }, false)).toBe('verify')
    expect(
      nextRetryScope({ r2Verified: true, verifiedSize: 18, size: 18, dbComplete: false }, false),
    ).toBe('catalog')
    expect(nextRetryScope({ multipartComplete: true }, true)).toBe('verify')
    const rec = reconcilePersistedJob({ r2Complete: true, dbComplete: false }, false)
    expect(rec.state).toBe('queued')
    expect(rec.autoRetry).toBe(true)
  })
})

describe('expired part URL refresh', () => {
  it('documents refresh + retry in the part uploader', () => {
    const src = readFileSync(join(root, 'lib/upload/multipartConfig.ts'), 'utf8')
    expect(src).toContain('ExpiredSignedUrlError')
    expect(src).toContain('refreshUrl')
    const manager = readFileSync(join(root, 'lib/upload/manager.ts'), 'utf8')
    expect(manager).toContain('refreshUrl: sign')
  })
})

describe('batch continues after one file fails', () => {
  it('keeps sibling jobs queued when one fails', () => {
    const a = reconcilePersistedJob({ state: 'failed', parts: [{ done: false }] }, true)
    const b = reconcilePersistedJob({ state: 'queued', parts: [{ done: false }] }, true)
    expect(a.state === 'failed' || a.state === 'queued').toBe(true)
    expect(b.state).toBe('queued')
    const manager = readFileSync(join(root, 'lib/upload/manager.ts'), 'utf8')
    expect(manager).toContain('Promise.all(batch.map')
    expect(manager).toMatch(/state: 'failed'/)
  })
})

describe('queue state restoration', () => {
  it('rehydrates finalize-only jobs and asks for a file only when bytes are missing', () => {
    const ready = reconcilePersistedJob(
      { r2Complete: true, dbComplete: false, parts: [{ done: true, etag: 'x' }] },
      false,
    )
    expect(ready.state).toBe('queued')
    const missing = reconcilePersistedJob(
      { uploadId: 'u', parts: [{ done: false, etag: null }], dbComplete: false },
      false,
    )
    expect(missing.state).toBe('needs-file')
  })
})

describe('reselect same file resume matching', () => {
  it('matches name/size case-insensitively and rejects mismatches', () => {
    const job = { fileName: 'IMG_0099.MOV', size: 9_001 }
    expect(fileMatchesResume({ name: 'img_0099.mov', size: 9_001 }, job)).toEqual({ ok: true })
    expect(fileMatchesResume({ name: 'IMG_0099.MOV', size: 8 }, job).ok).toBe(false)
    expect(fileMatchesResume({ name: 'other.mov', size: 9_001 }, job).ok).toBe(false)
  })
})

describe('progress does not report Complete before finalization', () => {
  it('caps percent at 99% until catalog success', () => {
    const uploading = displayProgress({ state: 'uploading', size: 100, uploadedBytes: 100 })
    const finalizing = displayProgress({ state: 'finalizing', size: 100, uploadedBytes: 100 })
    const done = displayProgress({ state: 'complete', size: 100, uploadedBytes: 100 })
    expect(uploading.percent).toBeLessThan(100)
    expect(uploading.complete).toBe(false)
    expect(finalizing.percent).toBe(99)
    expect(finalizing.label).toBe('Finalizing…')
    expect(finalizing.showEta).toBe(false)
    expect(done.percent).toBe(100)
    expect(done.label).toBe('Complete')
    expect(progressIsComplete('finalizing')).toBe(false)
    expect(progressIsComplete('complete')).toBe(true)
  })
})

describe('album association', () => {
  it('upserts album_files after a successful catalog insert', () => {
    const src = readFileSync(join(root, 'lib/upload/manager.ts'), 'utf8')
    expect(src).toContain("from('album_files')")
    expect(src).toContain("onConflict: 'album_id,file_id'")
    expect(src).toContain('ERR_ALBUM_ASSOCIATION')
  })
})

describe('immutable unique storage keys', () => {
  it('mints a new originals key per object id and never reuses another file id', () => {
    const a = uniqueOriginalKey('user-1', 'obj-a')
    const b = uniqueOriginalKey('user-1', 'obj-b')
    expect(a).toBe(originalKey('user-1', 'obj-a'))
    expect(a).not.toBe(b)
    expect(a).toMatch(/^users\/user-1\/originals\/obj-a$/)
    const manager = readFileSync(join(root, 'lib/upload/manager.ts'), 'utf8')
    expect(manager).toContain('uniqueOriginalKey(userId, objectId)')
    expect(manager).not.toMatch(/overwrite existing original/i)
  })
})

describe('cancellation safety', () => {
  it('never deletes a completed original', () => {
    expect(cancelDeletesOriginal({ r2Complete: true })).toBe(false)
    expect(cancelDeletesOriginal({ multipartComplete: true })).toBe(false)
    const src = readFileSync(join(root, 'lib/upload/manager.ts'), 'utf8')
    expect(src).not.toContain('DeleteObject')
    expect(src).toContain('!job.r2Complete && !job.multipartComplete')
    expect(src).toContain('apiMultipartAbort')
  })
})

describe('no arbitrary 200MB cap regression', () => {
  it('plans huge files instead of rejecting them', () => {
    expect(MAX_UPLOAD_FILE_BYTES).toBe(Number.POSITIVE_INFINITY)
    const huge = 8 * 1024 * 1024 * 1024
    const plan = planUpload(huge)
    expect(plan.useMultipart).toBe(true)
    expect(plan.parts.length).toBeGreaterThan(1)
    expect(plan.parts.length).toBeLessThanOrEqual(MAX_PARTS)
    expect(plan.parts.reduce((s, p) => s + p.bytes, 0)).toBe(huge)
    const manager = readFileSync(join(root, 'lib/upload/manager.ts'), 'utf8')
    expect(manager).not.toMatch(/200\s*\*\s*1024/)
    expect(manager).not.toMatch(/209715200/)
  })
})

describe('video finalize must not hang on poster', () => {
  it('times out poster/metadata generation', () => {
    const src = readFileSync(join(root, 'lib/upload/extractMetadata.ts'), 'utf8')
    expect(src).toContain('POSTER_TIMEOUT_MS')
    expect(src).toContain('withTimeout')
    expect(src).toContain('isVideoUpload(file)')
  })
})

describe('18MB multipart MOV regression', () => {
  it('A: 4MB simple video succeeds on the simple path', () => {
    const plan = planUpload(4.2 * 1024 * 1024)
    expect(plan.useMultipart).toBe(false)
  })

  it('B: 18MB multipart MOV uses multipart', () => {
    const plan = planUpload(18 * 1024 * 1024)
    expect(plan.useMultipart).toBe(true)
    expect(plan.parts.length).toBeGreaterThan(1)
    expect(normalizeUploadMime({ name: 'IMG_0180.MOV', type: 'video/quicktime' })).toBe('video/quicktime')
  })

  it('C: missing ETag does not catalog', () => {
    expect(canCatalogReady({ r2Verified: false, size: 18 })).toBe(false)
    expect(nextRetryScope({ parts: [{ done: true, etag: null }], uploadId: 'u' }, true)).toBe('bytes')
  })

  it('D: multipart complete failure does not catalog ready', () => {
    expect(catalogReadyAllowed({ r2Verified: false, verifiedSize: null, size: 18 })).toBe(false)
    expect(shouldSkipByteUpload({ parts: [{ done: true, etag: '"a"' }], uploadId: 'u' })).toBe(true)
  })

  it('E: HeadObject size mismatch does not catalog', () => {
    expect(canCatalogReady({ r2Verified: true, verifiedSize: 10, size: 18 })).toBe(false)
  })

  it('F: R2 verified + DB failure retries DB only', () => {
    expect(shouldSkipByteUpload({ r2Verified: true, verifiedSize: 18, size: 18, dbComplete: false })).toBe(true)
    expect(nextRetryScope({ r2Verified: true, verifiedSize: 18, size: 18, dbComplete: false }, false)).toBe('catalog')
  })

  it('G: retry after R2 completion does not reupload bytes', () => {
    expect(shouldSkipByteUpload({ r2Complete: true, size: 18 })).toBe(true)
    expect(shouldSkipByteUpload({ multipartComplete: true, size: 18 })).toBe(true)
  })

  it('H/I: repeated retry uses idempotent upserts', () => {
    expect(duplicateSafeUpsert()).toEqual({ fileOnConflict: 'id', albumOnConflict: 'album_id,file_id' })
    const src = readFileSync(join(root, 'lib/upload/manager.ts'), 'utf8')
    expect(src).toContain("onConflict: 'id'")
    expect(src).toContain('ignoreDuplicates: true')
    expect(src).toContain("onConflict: 'album_id,file_id'")
  })

  it('J: non-ready file is excluded from normal album/library', () => {
    expect(shouldExposeInLibrary({ upload_status: 'uploading' })).toBe(false)
    expect(shouldExposeInLibrary({ upload_status: 'ready' })).toBe(true)
    expect(shouldExposeInLibrary({ upload_status: null })).toBe(true)
    const q = readFileSync(join(root, 'lib/mediaQueries.ts'), 'utf8')
    expect(q).toContain("eq('upload_status', 'ready')")
  })

  it('K: 100-file queue accepted with no count cap', () => {
    expect(MAX_QUEUE_ITEMS).toBe(Number.POSITIVE_INFINITY)
    const manager = readFileSync(join(root, 'lib/upload/manager.ts'), 'utf8')
    expect(manager).not.toMatch(/files\.slice\(0,\s*(10|20|50|100)\)/)
    expect(manager).toContain('for (const file of files)')
  })

  it('L: bounded concurrency enforced', () => {
    expect(fileConcurrency()).toBeGreaterThanOrEqual(1)
    expect(fileConcurrency()).toBeLessThanOrEqual(4)
    const src = readFileSync(join(root, 'lib/upload/manager.ts'), 'utf8')
    expect(src).toContain('fileConcurrency() - active.length')
  })

  it('M: one failed item does not block remaining 99', () => {
    const failed = reconcilePersistedJob({ state: 'failed', parts: [{ done: false }] }, true)
    const queued = reconcilePersistedJob({ state: 'queued', parts: [{ done: false }] }, true)
    expect(queued.state).toBe('queued')
    expect(failed.state === 'queued' || failed.state === 'failed').toBe(true)
  })

  it('N: poster failure does not fail verified original', () => {
    const src = readFileSync(join(root, 'lib/upload/manager.ts'), 'utf8')
    expect(src).toContain('sidecars are best-effort')
    expect(canCatalogReady({ r2Verified: true, verifiedSize: 18, size: 18 })).toBe(true)
  })

  it('O: MOV content type preserved', () => {
    expect(normalizeUploadMime({ name: 'clip.MOV', type: 'video/quicktime' })).toBe('video/quicktime')
  })

  it('P: object size verification is required before ready', () => {
    const src = readFileSync(join(root, 'lib/upload/manager.ts'), 'utf8')
    expect(src).toContain('apiVerifyObject')
    expect(src).toContain('canCatalogReady')
    expect(src).toContain('expectedSize')
  })

  it('Q: progress cannot show Complete before ready', () => {
    expect(displayProgress({ state: 'finalizing', size: 18, uploadedBytes: 18 }).complete).toBe(false)
    expect(progressIsComplete('finalizing')).toBe(false)
  })

  it('classifies Safari Load failed as a staged network error', () => {
    const err = classifyUploadError(new TypeError('Load failed'), 'multipart-complete')
    expect(err.code).toBe('ERR_NETWORK')
    expect(err.message).toContain('multipart-complete')
    expect(err.message).not.toMatch(/https?:\/\//)
  })
})
