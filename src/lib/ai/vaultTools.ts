/**
 * Controlled Vault AI tools — additive org ops only; no delete/trash/storage wipe.
 */
import { supabase } from '../supabase'
import { listTags, createTag, addTagsToFiles, removeTagsFromFiles, normalizeTagName } from '../tags'
import { addFilesToAlbum } from '../albumMembership'
import { fetchVaultStorageStats, fetchDuplicateGroups, fetchAlbumStorageStats } from '../storageStats'
import { listMediaPage } from '../mediaQueries'
import { DEFAULT_MEDIA_FILTERS, type MediaFilters } from '../../types/media'
import {
  analysisMatchesFocus,
  analyzeMediaVisual,
  listAlbumContentFiles,
  type VisualFocus,
} from './visualAnalysis'
import { applyPersonSlotsFromAnalysis, ensureNeutralPersonGroups, listPersonGroups } from '../personGroups'

export type VaultToolName =
  | 'list_tags'
  | 'create_tag'
  | 'assign_tag'
  | 'remove_tag'
  | 'search_by_tags'
  | 'get_favorites'
  | 'get_duplicates'
  | 'get_storage_stats'
  | 'get_album_stats'
  | 'search_metadata'
  | 'create_album'
  | 'add_media_to_album'
  | 'list_albums'
  | 'analyze_album_visual'
  | 'list_person_groups'

export type VaultToolCall = {
  name: VaultToolName
  args: Record<string, unknown>
}

export type VaultToolResult = {
  ok: boolean
  tool: VaultToolName
  summary: string
  data?: unknown
  error?: string
}

export type VaultToolContext = {
  accessToken?: string | null
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map(String).filter(Boolean)
}

async function resolveAlbumId(userId: string, nameOrId: string): Promise<string | null> {
  const raw = nameOrId.trim()
  if (!raw) return null
  if (/^[0-9a-f-]{36}$/i.test(raw)) return raw
  const { data, error } = await supabase
    .from('albums')
    .select('id, name')
    .eq('user_id', userId)
    .ilike('name', raw)
    .limit(5)
  if (error) throw new Error(error.message)
  if (!data?.length) return null
  const exact = data.find((a) => a.name.toLowerCase() === raw.toLowerCase())
  return (exact || data[0])!.id
}

export async function runVaultTool(
  userId: string,
  call: VaultToolCall,
  ctx: VaultToolContext = {},
): Promise<VaultToolResult> {
  try {
    switch (call.name) {
      case 'list_tags': {
        const tags = await listTags(userId)
        return { ok: true, tool: call.name, summary: `${tags.length} tags`, data: tags.map((t) => ({ id: t.id, name: t.name })) }
      }
      case 'create_tag': {
        const name = String(call.args.name ?? '')
        const tag = await createTag(userId, name)
        return { ok: true, tool: call.name, summary: `Created tag ${tag.name}`, data: { id: tag.id, name: tag.name } }
      }
      case 'assign_tag': {
        const tagIds = asStringArray(call.args.tagIds)
        const fileIds = asStringArray(call.args.fileIds)
        if (!tagIds.length || !fileIds.length) throw new Error('tagIds and fileIds required')
        await addTagsToFiles(userId, fileIds, tagIds)
        return { ok: true, tool: call.name, summary: `Assigned ${tagIds.length} tag(s) to ${fileIds.length} item(s)` }
      }
      case 'remove_tag': {
        const tagIds = asStringArray(call.args.tagIds)
        const fileIds = asStringArray(call.args.fileIds)
        await removeTagsFromFiles(userId, fileIds, tagIds)
        return { ok: true, tool: call.name, summary: `Removed tag(s) from ${fileIds.length} item(s)` }
      }
      case 'search_by_tags': {
        const tagIds = asStringArray(call.args.tagIds)
        const filters: MediaFilters = {
          ...DEFAULT_MEDIA_FILTERS,
          tagIds,
          tagMode: call.args.mode === 'or' ? 'or' : 'and',
        }
        const page = await listMediaPage({ userId, filters, cursor: null })
        return {
          ok: true,
          tool: call.name,
          summary: `Found ${page.rows.length} matching item(s) on first page`,
          data: page.rows.map((r) => ({ id: r.id, name: r.file_name })),
        }
      }
      case 'get_favorites': {
        const page = await listMediaPage({
          userId,
          filters: { ...DEFAULT_MEDIA_FILTERS, favorite: 'yes' },
          cursor: null,
        })
        return {
          ok: true,
          tool: call.name,
          summary: `${page.rows.length} favorite(s) on first page`,
          data: page.rows.map((r) => ({ id: r.id, name: r.file_name })),
        }
      }
      case 'get_duplicates': {
        const groups = await fetchDuplicateGroups()
        return { ok: true, tool: call.name, summary: `${groups.length} duplicate group(s)`, data: groups.slice(0, 20) }
      }
      case 'get_storage_stats': {
        const stats = await fetchVaultStorageStats()
        return { ok: true, tool: call.name, summary: stats ? `Vault has ${stats.total_items} items` : 'Stats unavailable', data: stats }
      }
      case 'get_album_stats': {
        const stats = await fetchAlbumStorageStats()
        return { ok: true, tool: call.name, summary: `${stats.length} album(s) with stats`, data: stats }
      }
      case 'search_metadata': {
        const q = String(call.args.query ?? '').trim()
        const domain = String(call.args.sourceDomain ?? '').trim().toLowerCase()
        const year = call.args.createdYear != null ? Number(call.args.createdYear) : null
        let filters: MediaFilters = { ...DEFAULT_MEDIA_FILTERS, search: q }
        if (year && Number.isFinite(year)) {
          filters = {
            ...filters,
            capturedFrom: `${year}-01-01T00:00:00.000Z`,
            capturedTo: `${year}-12-31T23:59:59.999Z`,
          }
        }
        const page = await listMediaPage({ userId, filters, cursor: null })
        let rows = page.rows
        if (domain) {
          rows = rows.filter((r) => {
            const src = String((r as { source_url?: string | null }).source_url || r.file_url || '').toLowerCase()
            return src.includes(domain)
          })
        }
        return {
          ok: true,
          tool: call.name,
          summary: `${rows.length} metadata match(es)`,
          data: rows.map((r) => ({ id: r.id, name: r.file_name })),
        }
      }
      case 'create_album': {
        const name = String(call.args.name ?? '').trim()
        if (!name) throw new Error('Album name required')
        const { data, error } = await supabase
          .from('albums')
          .insert({ user_id: userId, name })
          .select('id, name')
          .single()
        if (error) throw new Error(error.message)
        return { ok: true, tool: call.name, summary: `Created album ${data.name}`, data }
      }
      case 'add_media_to_album': {
        const albumId = String(call.args.albumId ?? '')
        const fileIds = asStringArray(call.args.fileIds)
        if (!albumId || !fileIds.length) throw new Error('albumId and fileIds required')
        await addFilesToAlbum(userId, albumId, fileIds)
        return { ok: true, tool: call.name, summary: `Added ${fileIds.length} item(s) to album` }
      }
      case 'list_albums': {
        const { data, error } = await supabase.from('albums').select('id, name').eq('user_id', userId).order('name')
        if (error) throw new Error(error.message)
        return { ok: true, tool: call.name, summary: `${(data ?? []).length} album(s)`, data: data ?? [] }
      }
      case 'list_person_groups': {
        const groups = await listPersonGroups(userId)
        return {
          ok: true,
          tool: call.name,
          summary: `${groups.length} person group(s) (neutral labels; not identities)`,
          data: groups.map((g) => ({ id: g.id, label: g.label })),
        }
      }
      case 'analyze_album_visual': {
        const token = ctx.accessToken
        if (!token) throw new Error('Signed-in session required for visual analysis')
        const albumRef = String(call.args.albumId || call.args.albumName || '')
        const albumId = await resolveAlbumId(userId, albumRef)
        if (!albumId) throw new Error(`Album not found: ${albumRef || '(empty)'}`)
        const tagName = String(call.args.tagName || '').trim()
        const focus: VisualFocus = {
          peopleCount: call.args.peopleCount != null ? Number(call.args.peopleCount) : null,
          blondeHair: call.args.blondeHair === true,
          freeText: String(call.args.focus || ''),
        }
        const files = await listAlbumContentFiles(userId, albumId)
        // Hard scope: album only — never whole vault
        const maxAnalyze = Math.min(files.length, Number(call.args.limit) || 40)
        const matchedIds: string[] = []
        let analyzed = 0
        let cached = 0
        let visionErrors = 0
        let linkedPeople = 0
        for (const file of files.slice(0, maxAnalyze)) {
          const result = await analyzeMediaVisual({
            userId,
            accessToken: token,
            file,
            focus,
          })
          if (result.fromCache) cached += 1
          else if (result.analysis) analyzed += 1
          else visionErrors += 1
          const people =
            result.analysis && typeof result.analysis.people_count === 'number'
              ? result.analysis.people_count
              : null
          if (
            analysisMatchesFocus(
              {
                people_count: people,
                attributes: (result.analysis?.attributes as Record<string, unknown>) || {},
              },
              focus,
            )
          ) {
            matchedIds.push(file.id)
          }
          const slots = (result.analysis?.attributes as { person_slots?: { label?: string }[] } | undefined)
            ?.person_slots
          if (Array.isArray(slots) && slots.length) {
            linkedPeople += await applyPersonSlotsFromAnalysis(
              userId,
              file.id,
              slots,
              typeof result.analysis?.confidence === 'number' ? result.analysis.confidence : null,
            )
          }
        }
        let tagSummary = ''
        if (tagName && matchedIds.length) {
          const tag = await createTag(userId, tagName)
          await addTagsToFiles(userId, matchedIds, [tag.id])
          tagSummary = ` Tagged ${matchedIds.length} with “${tag.name}”.`
        }
        if (call.args.ensurePersonGroups === true) {
          const maxPeople = Math.max(
            0,
            ...files.slice(0, maxAnalyze).map(() => 0),
            Number(call.args.peopleCount) || 0,
            3,
          )
          await ensureNeutralPersonGroups(userId, maxPeople || 3)
        }
        return {
          ok: true,
          tool: call.name,
          summary: `Album scope ${albumId}: ${files.length} items, analyzed ${analyzed}, cache hits ${cached}, matched ${matchedIds.length}, vision errors ${visionErrors}, person links ${linkedPeople}.${tagSummary}`,
          data: { albumId, matchedIds, analyzed, cached, visionErrors },
        }
      }
      default:
        return { ok: false, tool: call.name, summary: 'Unknown tool', error: 'Unknown tool' }
    }
  } catch (e) {
    return {
      ok: false,
      tool: call.name,
      summary: 'Tool failed',
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/** Deterministic planner for common metadata / scoped visual requests without an LLM. */
export function planFromPrompt(prompt: string): VaultToolCall[] {
  const text = prompt.trim()
  const lower = text.toLowerCase()
  const calls: VaultToolCall[] = []

  if (/how much storage|storage stats|how big is (my )?vault/i.test(lower)) {
    calls.push({ name: 'get_storage_stats', args: {} })
  }
  if (/duplicate/i.test(lower)) calls.push({ name: 'get_duplicates', args: {} })
  if (/favorite/i.test(lower) && /show|list|find/i.test(lower)) calls.push({ name: 'get_favorites', args: {} })
  if (/list (my )?tags|what tags/i.test(lower)) calls.push({ name: 'list_tags', args: {} })
  if (/list (my )?albums/i.test(lower)) calls.push({ name: 'list_albums', args: {} })
  if (/person group|people group/i.test(lower)) calls.push({ name: 'list_person_groups', args: {} })

  const createTag = text.match(/create (?:a )?tag (?:called |named )?["']?([^"'.]+)["']?/i)
  if (createTag) calls.push({ name: 'create_tag', args: { name: normalizeTagName(createTag[1]!).name } })

  const createAlbum = text.match(/create (?:an? )?album (?:called |named )?["']?([^"'.]+)["']?/i)
  if (createAlbum) calls.push({ name: 'create_album', args: { name: createAlbum[1]!.trim() } })

  const year = text.match(/\b(19|20)\d{2}\b/)
  if (/created in|from |captured in|shot in/i.test(lower) && year) {
    calls.push({ name: 'search_metadata', args: { createdYear: Number(year[0]), query: '' } })
  }

  const domain = text.match(/(?:source|url|domain).*?\b([a-z0-9.-]+\.[a-z]{2,})\b/i)
  if (domain) calls.push({ name: 'search_metadata', args: { sourceDomain: domain[1], query: '' } })

  if (!calls.length && /album stats|per album|album storage/i.test(lower)) {
    calls.push({ name: 'get_album_stats', args: {} })
  }

  // Scoped visual: must mention an album (never whole vault by default)
  const albumMatch =
    text.match(/inside\s+(?:album\s+)?["']?([^"'.]+?)["']?(?=\s+and\b|\s+find\b|\s+tag\b|,|$)/i) ||
    text.match(/album\s+["']?([^"'.]+?)["']?(?=\s|,|$)/i) ||
    text.match(/only\s+(?:in|inside)\s+["']?([^"'.]+?)["']?/i)

  const wantsVisual =
    /two people|blonde|analyze|visual|people count|containing exactly/i.test(lower) &&
    (/album|inside|only/i.test(lower) || Boolean(albumMatch))

  if (wantsVisual && albumMatch) {
    const albumName = albumMatch[1]!.trim()
    const people = /exactly\s+two\s+people|two\s+people/i.test(lower)
      ? 2
      : /exactly\s+(\d+)\s+people/i.test(lower)
        ? Number(lower.match(/exactly\s+(\d+)\s+people/i)![1])
        : null
    const blonde = /blonde/i.test(lower)
    let tagName = ''
    const tagAs = text.match(/tag\s+(?:it|them|everything)?\s*(?:as\s+)?["']?([A-Za-z0-9][^"'.]*)["']?/i)
    const tagCalled = text.match(/tag\s+(?:called|named)\s+["']?([^"'.]+)["']?/i)
    if (tagCalled) tagName = tagCalled[1]!.trim()
    else if (/two people/i.test(lower) && /tag/i.test(lower)) tagName = 'Two People'
    else if (blonde && /tag/i.test(lower)) tagName = 'Blonde'
    else if (tagAs) tagName = tagAs[1]!.trim()

    calls.push({
      name: 'analyze_album_visual',
      args: {
        albumName,
        peopleCount: people,
        blondeHair: blonde,
        tagName,
        ensurePersonGroups: /person\s+\d|group.*people|recurring people/i.test(lower),
      },
    })
  }

  return calls
}

export async function runDeterministicVaultAgent(
  userId: string,
  prompt: string,
  ctx: VaultToolContext = {},
): Promise<{ reply: string; results: VaultToolResult[] }> {
  const plan = planFromPrompt(prompt)
  if (!plan.length) {
    return {
      reply:
        'I can help with tags, albums, favorites, duplicates, storage stats, metadata search, and album-scoped visual analysis. Visual analysis needs a server AI key. Try: “Show favorites”, “Show duplicates”, or “Inside Album X find everything containing exactly two people and tag it Two People”.',
      results: [],
    }
  }
  const results: VaultToolResult[] = []
  for (const call of plan) {
    results.push(await runVaultTool(userId, call, ctx))
  }
  const reply = results.map((r) => (r.ok ? `• ${r.summary}` : `• Failed (${r.tool}): ${r.error}`)).join('\n')
  return { reply: reply || 'Done.', results }
}
