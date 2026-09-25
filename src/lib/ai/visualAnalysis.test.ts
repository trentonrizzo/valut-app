import { describe, expect, it } from 'vitest'
import { extractMp4MovCaptureDateFromBuffer } from '../upload/videoCaptureDate'
import { planFromPrompt } from './vaultTools'
import { analysisMatchesFocus } from './visualAnalysis'

/** Minimal mvhd v0 atom with Mac epoch creation ≈ 2021-04-17 */
function buildMvhdBuffer(macCreationSec: number): ArrayBuffer {
  // Top-level mvhd atom for scanner
  const buf = new ArrayBuffer(32)
  const view = new DataView(buf)
  // Fake as top-level mvhd for scanner (scanAtoms walks top-level)
  view.setUint32(0, 32) // size
  view.setUint8(4, 0x6d) // m
  view.setUint8(5, 0x76) // v
  view.setUint8(6, 0x68) // h
  view.setUint8(7, 0x64) // d
  view.setUint8(8, 0) // version
  view.setUint8(9, 0)
  view.setUint8(10, 0)
  view.setUint8(11, 0)
  view.setUint32(12, macCreationSec) // creation
  view.setUint32(16, macCreationSec) // modification
  return buf
}

describe('video capture date', () => {
  it('reads mvhd Mac epoch when trustworthy', () => {
    // 2021-04-17 ~ unix 1618616400 → mac = unix + 2082844800
    const mac = 1618616400 + 2082844800
    const iso = extractMp4MovCaptureDateFromBuffer(buildMvhdBuffer(mac))
    expect(iso).toBeTruthy()
    expect(iso!.startsWith('2021-04-')).toBe(true)
  })

  it('rejects zero / bogus creation', () => {
    expect(extractMp4MovCaptureDateFromBuffer(buildMvhdBuffer(0))).toBeNull()
    expect(extractMp4MovCaptureDateFromBuffer(buildMvhdBuffer(100))).toBeNull()
  })
})

describe('album-scoped visual planner', () => {
  it('plans analyze_album_visual for two-people tag request', () => {
    const plan = planFromPrompt(
      'Look only inside Album X and tag everything containing exactly two people as Two People.',
    )
    expect(plan.some((c) => c.name === 'analyze_album_visual')).toBe(true)
    const call = plan.find((c) => c.name === 'analyze_album_visual')!
    expect(call.args.peopleCount).toBe(2)
    expect(call.args.tagName).toBe('Two People')
    expect(String(call.args.albumName)).toMatch(/X/i)
  })

  it('does not analyze whole vault when album missing', () => {
    const plan = planFromPrompt('Find everything with blonde hair and tag Blonde')
    expect(plan.every((c) => c.name !== 'analyze_album_visual')).toBe(true)
  })

  it('never plans delete tools', () => {
    const plan = planFromPrompt('Inside Album X permanently delete all media')
    expect(plan.every((c) => !/delete|empty|wipe/i.test(c.name))).toBe(true)
  })
})

describe('analysis focus match', () => {
  it('matches people count and blonde', () => {
    expect(analysisMatchesFocus({ people_count: 2, attributes: { blonde_hair: true } }, { peopleCount: 2, blondeHair: true })).toBe(
      true,
    )
    expect(analysisMatchesFocus({ people_count: 1, attributes: { blonde_hair: true } }, { peopleCount: 2 })).toBe(false)
  })
})
