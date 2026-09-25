import { describe, expect, it } from 'vitest'
import {
  emptyPayload,
  normalizePayload,
  projectMediaCount,
  type EditorProjectPayload,
} from './projects'

describe('editor project payload v2', () => {
  it('emptyPayload uses scenes with up to 4 layers', () => {
    const p = emptyPayload('2x2')
    expect(p.version).toBe(2)
    expect(p.scenes).toHaveLength(1)
    expect(p.scenes[0]!.layers).toHaveLength(4)
    expect(projectMediaCount(p)).toBe(0)
  })

  it('migrates legacy slots into a scene', () => {
    const legacy = {
      layout: '1x2',
      audioMasterIndex: 0,
      multiAudio: false,
      slots: [
        { fileId: 'f1', kind: 'video', trimStart: 1, trimEnd: 4, muted: false, objectFit: 'cover' },
        { fileId: 'f2', kind: 'image', trimStart: 0, trimEnd: null, muted: true, objectFit: 'contain' },
      ],
    } as unknown as EditorProjectPayload
    const n = normalizePayload(legacy)
    expect(n.scenes).toHaveLength(1)
    expect(n.scenes[0]!.layers[0]!.fileId).toBe('f1')
    expect(n.scenes[0]!.layers[0]!.trimStart).toBe(1)
    expect(n.scenes[0]!.layers[1]!.fileId).toBe('f2')
    expect(projectMediaCount(n)).toBe(2)
  })

  it('preserves zoom pan speed photoDuration in normalize', () => {
    const p = emptyPayload('1')
    p.scenes[0]!.layers[0] = {
      ...p.scenes[0]!.layers[0]!,
      fileId: 'x',
      kind: 'image',
      zoom: 1.5,
      panX: 0.1,
      photoDuration: 7,
      speed: 1,
    }
    const n = normalizePayload(p)
    expect(n.scenes[0]!.layers[0]!.zoom).toBe(1.5)
    expect(n.scenes[0]!.layers[0]!.photoDuration).toBe(7)
  })
})
