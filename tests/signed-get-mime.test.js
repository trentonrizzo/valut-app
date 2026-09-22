import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { responseContentType } from '../api/storage/_mime.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('signed GET video content type', () => {
  it('labels .mov as video/quicktime even if stored mime is mp4 or blank', () => {
    expect(responseContentType('video/mp4', 'IMG_3432.mov')).toBe('video/quicktime')
    expect(responseContentType(null, 'IMG_3432.MOV')).toBe('video/quicktime')
    expect(responseContentType('application/octet-stream', 'clip.mov')).toBe('video/quicktime')
  })

  it('keeps real mp4 types for mp4 names', () => {
    expect(responseContentType('video/mp4', 'clip.mp4')).toBe('video/mp4')
  })

  it('signed GET stays inline and CORS exposes range headers', () => {
    const signed = readFileSync(join(root, 'api/storage/signed-get.js'), 'utf8')
    const cors = readFileSync(join(root, 'api/storage/_s3.js'), 'utf8')
    const resolve = readFileSync(join(root, 'src/lib/media/resolveMedia.ts'), 'utf8')
    expect(signed).toContain('responseContentType')
    expect(signed).toContain("ResponseContentDisposition: 'inline'")
    expect(cors).toContain('Content-Range')
    expect(cors).toContain('Accept-Ranges')
    expect(cors).toMatch(/AllowedMethods: \['GET', 'PUT', 'HEAD'\]/)
    expect(resolve).toContain('fetchSignedWithRetry')
    expect(resolve).toContain('invalidateSignedMedia')
  })
})
