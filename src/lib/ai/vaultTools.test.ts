import { describe, expect, it } from 'vitest'
import { planFromPrompt } from './vaultTools'
import { aspectRatioLabel, resolutionLabel } from '../mediaDetails'
import { formatEta } from '../upload/strategy'

describe('vault AI planner', () => {
  it('plans storage and duplicate requests', () => {
    const a = planFromPrompt('How much storage does my Vault use?')
    expect(a.some((c) => c.name === 'get_storage_stats')).toBe(true)
    const b = planFromPrompt('Show me duplicate uploads')
    expect(b.some((c) => c.name === 'get_duplicates')).toBe(true)
  })

  it('plans create tag and favorites including Open Favorites', () => {
    expect(planFromPrompt('Create a tag called Example').some((c) => c.name === 'create_tag')).toBe(true)
    expect(planFromPrompt('Show favorites').some((c) => c.name === 'get_favorites')).toBe(true)
    const open = planFromPrompt('Open my favorites')
    expect(open.some((c) => c.name === 'navigate' && (c.args as { path?: string }).path === '/favorites')).toBe(true)
    expect(open.some((c) => c.name === 'get_favorites')).toBe(true)
  })

  it('plans create album chicken nuggets without OpenAI', () => {
    const plan = planFromPrompt('Create a new album called chicken nuggets')
    expect(plan.some((c) => c.name === 'create_album' && /chicken nuggets/i.test(String(c.args.name)))).toBe(true)
  })

  it('does not invent destructive tools', () => {
    const plan = planFromPrompt('Delete everything in my vault permanently')
    expect(plan.every((c) => !/delete|empty|wipe/i.test(c.name))).toBe(true)
  })

  it('plans show tagged queries', () => {
    const plan = planFromPrompt('Show everything tagged Blonde')
    expect(plan.some((c) => c.name === 'search_by_tags')).toBe(true)
  })
})

describe('media details helpers', () => {
  it('formats aspect and resolution', () => {
    expect(aspectRatioLabel(1920, 1080)).toBe('16:9')
    expect(resolutionLabel(1920, 1080)).toBe('1080p')
    expect(aspectRatioLabel(null, 1080)).toBeNull()
  })
})

describe('upload ETA formatting', () => {
  it('buckets short ETAs', () => {
    expect(formatEta(2)).toBe('~5s left')
    expect(formatEta(12)).toBe('~10s left')
    expect(formatEta(90)).toBe('~2m left')
  })
})
