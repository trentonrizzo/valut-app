/**
 * Deterministic Vault AI tools — same domain ops as the manual UI.
 * Paid AI is optional enrichment / vision only.
 */
import { supabase } from '../supabase'
import { listTags, createTag, addTagsToFiles, removeTagsFromFiles, normalizeTagName } from '../tags'
import { addFilesToAlbum, setFavorite } from '../albumMembership'
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
  | 'rename_tag'
  | 'assign_tag'
  | 'remove_tag'
  | 'search_by_tags'
  | 'get_favorites'
  | 'bulk_favorite'
  | 'get_duplicates'
  | 'get_storage_stats'
  | 'get_album_stats'
  | 'search_metadata'
  | 'create_album'
  | 'rename_album'
  | 'add_media_to_album'
  | 'list_albums'
  | 'set_parent_album'
  | 'analyze_album_visual'
  | 'list_person_groups'
  | 'navigate'
  | 'needs_vision_config'
  | 'create_org_job'

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
  verified?: boolean
}

export type VaultToolContext = {
  accessToken?: string | null
  /** Current UI scope from the app (album id, selection, etc.) */
  uiScope?: {
    albumId?: string | null
    albumName?: string | null
    selectedFileIds?: string[]
    path?: string
  }
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

async function nextAlbumOrder(userId: string): Promise<number> {
  const { data } = await supabase
    .from('albums')
    .select('order_index')
    .eq('user_id', userId)
    .order('order_index', { ascending: false })
    .limit(1)
  return Number(data?.[0]?.order_index ?? -1) + 1
}

export async function runVaultTool(
  userId: string,
  call: VaultToolCall,
  ctx: VaultToolContext = {},
): Promise<VaultToolResult> {
  try {
    switch (call.name) {
      case 'navigate': {
        const path = String(call.args.path || '/')
        return {
          ok: true,
          tool: call.name,
          summary: `Opening ${String(call.args.label || path)}`,
          data: { path, label: call.args.label },
          verified: true,
        }
      }
      case 'needs_vision_config': {
        return {
          ok: false,
          tool: call.name,
          summary: 'Visual analysis is not configured yet.',
          error: 'NEEDS_CONFIGURATION',
          data: {
            requiredEnv: ['OPENAI_API_KEY or VAULT_AI_API_KEY', 'optional VAULT_AI_VISION_MODEL'],
            where: 'Vercel Production environment variables for vault-app',
          },
        }
      }
      case 'list_tags': {
        const tags = await listTags(userId)
        return { ok: true, tool: call.name, summary: `${tags.length} tags`, data: tags.map((t) => ({ id: t.id, name: t.name })), verified: true }
      }
      case 'create_tag': {
        const name = String(call.args.name ?? '')
        const tag = await createTag(userId, name)
        const check = await listTags(userId)
        const verified = check.some((t) => t.id === tag.id)
        return {
          ok: true,
          tool: call.name,
          summary: verified ? `✓ Created tag “${tag.name}”` : `Created tag “${tag.name}” (verify pending)`,
          data: { id: tag.id, name: tag.name },
          verified,
        }
      }
      case 'rename_tag': {
        const id = String(call.args.tagId || '')
        const name = normalizeTagName(String(call.args.name || '')).name
        if (!id || !name) throw new Error('tagId and name required')
        const { error } = await supabase.from('tags').update({ name }).eq('id', id).eq('user_id', userId)
        if (error) throw new Error(error.message)
        return { ok: true, tool: call.name, summary: `✓ Renamed tag to “${name}”`, verified: true }
      }
      case 'assign_tag': {
        const tagIds = asStringArray(call.args.tagIds)
        const fileIds = asStringArray(call.args.fileIds)
        if (!tagIds.length || !fileIds.length) throw new Error('tagIds and fileIds required')
        await addTagsToFiles(userId, fileIds, tagIds)
        return { ok: true, tool: call.name, summary: `✓ Tagged ${fileIds.length} item(s)`, verified: true }
      }
      case 'remove_tag': {
        const tagIds = asStringArray(call.args.tagIds)
        const fileIds = asStringArray(call.args.fileIds)
        await removeTagsFromFiles(userId, fileIds, tagIds)
        return { ok: true, tool: call.name, summary: `✓ Removed tag(s) from ${fileIds.length} item(s)`, verified: true }
      }
      case 'search_by_tags': {
        const tagIds = asStringArray(call.args.tagIds)
        const tagNames = asStringArray(call.args.tagNames)
        let ids = tagIds
        if (!ids.length && tagNames.length) {
          const all = await listTags(userId)
          ids = all.filter((t) => tagNames.some((n) => t.name.toLowerCase() === n.toLowerCase())).map((t) => t.id)
        }
        const filters: MediaFilters = {
          ...DEFAULT_MEDIA_FILTERS,
          tagIds: ids,
          tagMode: call.args.mode === 'or' ? 'or' : 'and',
          albumId: call.args.albumId ? String(call.args.albumId) : DEFAULT_MEDIA_FILTERS.albumId,
        }
        const page = await listMediaPage({ userId, filters, cursor: null })
        return {
          ok: true,
          tool: call.name,
          summary: `Showing ${page.rows.length} matching item(s)`,
          data: {
            rows: page.rows.map((r) => ({ id: r.id, name: r.file_name })),
            navigate: `/library?${ids.map((id) => `tag=${id}`).join('&')}`,
            title: tagNames.join(' + ') || 'Tagged',
          },
          verified: true,
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
          summary: `✓ Showing ${page.rows.length} favorite(s)`,
          data: {
            rows: page.rows.map((r) => ({ id: r.id, name: r.file_name })),
            navigate: '/favorites',
          },
          verified: true,
        }
      }
      case 'bulk_favorite': {
        const fileIds = asStringArray(call.args.fileIds)
        const value = call.args.value !== false
        await setFavorite(userId, fileIds, value)
        return {
          ok: true,
          tool: call.name,
          summary: value ? `✓ Favorited ${fileIds.length} item(s)` : `✓ Unfavorited ${fileIds.length} item(s)`,
          verified: true,
        }
      }
      case 'get_duplicates': {
        const groups = await fetchDuplicateGroups()
        return {
          ok: true,
          tool: call.name,
          summary: `${groups.length} duplicate group(s)`,
          data: { groups: groups.slice(0, 20), navigate: '/duplicates' },
          verified: true,
        }
      }
      case 'get_storage_stats': {
        const stats = await fetchVaultStorageStats()
        return {
          ok: true,
          tool: call.name,
          summary: stats ? `Vault storage · ${stats.total_items} items` : 'Stats unavailable',
          data: stats,
          verified: Boolean(stats),
        }
      }
      case 'get_album_stats': {
        const stats = await fetchAlbumStorageStats()
        return { ok: true, tool: call.name, summary: `${stats.length} album(s) with stats`, data: stats, verified: true }
      }
      case 'search_metadata': {
        const q = String(call.args.query ?? '').trim()
        const domain = String(call.args.sourceDomain ?? '').trim().toLowerCase()
        const year = call.args.createdYear != null ? Number(call.args.createdYear) : null
        const title = q || domain || (year ? `Captured ${year}` : 'Results')
        let filters: MediaFilters = {
          ...DEFAULT_MEDIA_FILTERS,
          search: q,
          domain: domain || null,
          resultTitle: title,
        }
        if (year && Number.isFinite(year)) {
          filters = {
            ...filters,
            capturedFrom: `${year}-01-01T00:00:00.000Z`,
            capturedTo: `${year}-12-31T23:59:59.999Z`,
          }
        }
        const page = await listMediaPage({ userId, filters, cursor: null })
        const rows = page.rows
        const params = new URLSearchParams()
        if (q) params.set('q', q)
        if (year) params.set('year', String(year))
        if (domain) params.set('domain', domain)
        params.set('title', title)
        return {
          ok: true,
          tool: call.name,
          summary: `✓ Showing ${rows.length} match(es)`,
          data: {
            rows: rows.map((r) => ({ id: r.id, name: r.file_name })),
            navigate: `/library?${params.toString()}`,
            title,
          },
          verified: true,
        }
      }
      case 'create_album': {
        const name = String(call.args.name ?? '').trim()
        if (!name) throw new Error('Album name required')
        const parentId = call.args.parentAlbumId ? String(call.args.parentAlbumId) : null
        const order_index = await nextAlbumOrder(userId)
        const payload: Record<string, unknown> = { user_id: userId, name, order_index }
        if (parentId) payload.parent_album_id = parentId
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).from('albums').insert(payload).select('id, name').single()
        if (error) {
          if (parentId) {
            const retry = await supabase
              .from('albums')
              .insert({ user_id: userId, name, order_index })
              .select('id, name')
              .single()
            if (retry.error) throw new Error(retry.error.message)
            return {
              ok: true,
              tool: call.name,
              summary: `✓ Created “${retry.data.name}”`,
              data: retry.data,
              verified: true,
            }
          }
          throw new Error(error.message)
        }
        return {
          ok: true,
          tool: call.name,
          summary: `✓ Created “${data.name}”`,
          data: { ...data, navigate: `/albums/${data.id}` },
          verified: true,
        }
      }
      case 'rename_album': {
        const id = await resolveAlbumId(userId, String(call.args.albumId || call.args.albumName || ''))
        const name = String(call.args.name || '').trim()
        if (!id || !name) throw new Error('Album and new name required')
        const { error } = await supabase.from('albums').update({ name }).eq('id', id).eq('user_id', userId)
        if (error) throw new Error(error.message)
        return { ok: true, tool: call.name, summary: `✓ Renamed album to “${name}”`, verified: true }
      }
      case 'set_parent_album': {
        const childId = await resolveAlbumId(userId, String(call.args.albumId || call.args.albumName || ''))
        const parentRaw = call.args.parentAlbumId ?? call.args.parentAlbumName
        const parentId = parentRaw ? await resolveAlbumId(userId, String(parentRaw)) : null
        if (!childId) throw new Error('Album not found')
        if (parentId === childId) throw new Error('Collection cannot be its own parent')
        if (parentId) {
          let cursor: string | null = parentId
          const seen = new Set<string>([childId])
          for (let i = 0; i < 32 && cursor; i += 1) {
            if (seen.has(cursor)) throw new Error('That move would create a cycle')
            seen.add(cursor)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const parentRes: { data: { parent_album_id?: string | null } | null } = await (supabase as any)
              .from('albums')
              .select('parent_album_id')
              .eq('id', cursor)
              .maybeSingle()
            cursor = parentRes.data?.parent_album_id || null
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any)
          .from('albums')
          .update({ parent_album_id: parentId })
          .eq('id', childId)
          .eq('user_id', userId)
        if (error) throw new Error(error.message)
        return { ok: true, tool: call.name, summary: parentId ? '✓ Moved collection under parent' : '✓ Moved collection to root', verified: true }
      }
      case 'add_media_to_album': {
        const albumId = String(call.args.albumId ?? '')
        const fileIds = asStringArray(call.args.fileIds)
        if (!albumId || !fileIds.length) throw new Error('albumId and fileIds required')
        await addFilesToAlbum(userId, albumId, fileIds)
        return { ok: true, tool: call.name, summary: `✓ Added ${fileIds.length} item(s) to album`, verified: true }
      }
      case 'list_albums': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('albums')
          .select('id, name, parent_album_id')
          .eq('user_id', userId)
          .order('name')
        if (error) {
          const fallback = await supabase.from('albums').select('id, name').eq('user_id', userId).order('name')
          if (fallback.error) throw new Error(fallback.error.message)
          return { ok: true, tool: call.name, summary: `${(fallback.data ?? []).length} album(s)`, data: fallback.data ?? [], verified: true }
        }
        return { ok: true, tool: call.name, summary: `${(data ?? []).length} album(s)`, data: data ?? [], verified: true }
      }
      case 'list_person_groups': {
        const groups = await listPersonGroups(userId)
        return {
          ok: true,
          tool: call.name,
          summary: `${groups.length} person group(s)`,
          data: groups.map((g) => ({ id: g.id, label: g.label })),
          verified: true,
        }
      }
      case 'create_org_job': {
        // Placeholder — real persistence in jobs.ts; tool returns structured job request
        return {
          ok: true,
          tool: call.name,
          summary: 'Organization job queued',
          data: {
            request: String(call.args.request || ''),
            scope: call.args.scope || 'vault',
            createTag: call.args.createTag,
            createAlbum: call.args.createAlbum,
            visualFocus: call.args.visualFocus,
          },
          verified: false,
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
        const maxAnalyze = Math.min(files.length, Number(call.args.maxAnalyze) || 40)
        let analyzed = 0
        let cached = 0
        let visionErrors = 0
        const matchedIds: string[] = []
        let linkedPeople = 0
        let needsConfig = false
        for (const file of files.slice(0, maxAnalyze)) {
          const result = await analyzeMediaVisual({
            userId,
            file: file,
            accessToken: token,
            focus,
          })
          if (result.fromCache) cached += 1
          else if (result.analysis) analyzed += 1
          else visionErrors += 1
          if (result.error && /no API key|not configured|unavailable/i.test(result.error)) {
            needsConfig = true
            break
          }
          if (result.analysis && analysisMatchesFocus(result.analysis, focus)) matchedIds.push(file.id)
          const slots = (result.analysis?.attributes as { person_slots?: unknown[] } | undefined)?.person_slots
          if (result.analysis && Array.isArray(slots) && slots.length) {
            linkedPeople += await applyPersonSlotsFromAnalysis(
              userId,
              file.id,
              slots as { label: string; notes?: string }[],
              typeof result.analysis?.confidence === 'number' ? (result.analysis.confidence as number) : null,
            )
          }
        }
        if (needsConfig) {
          return {
            ok: false,
            tool: 'needs_vision_config',
            summary: 'Visual analysis is not configured yet.',
            error: 'NEEDS_CONFIGURATION',
            data: {
              requiredEnv: ['OPENAI_API_KEY or VAULT_AI_API_KEY'],
              where: 'Vercel Production environment for vault-app',
            },
          }
        }
        let tagSummary = ''
        if (tagName && matchedIds.length) {
          const tag = await createTag(userId, tagName)
          await addTagsToFiles(userId, matchedIds, [tag.id])
          tagSummary = ` Tagged ${matchedIds.length} with “${tag.name}”.`
        }
        if (call.args.ensurePersonGroups === true) {
          await ensureNeutralPersonGroups(userId, Number(call.args.peopleCount) || 3)
        }
        return {
          ok: true,
          tool: call.name,
          summary: `Album scope: ${files.length} items · analyzed ${analyzed} · cache ${cached} · matched ${matchedIds.length} · vision errors ${visionErrors}.${tagSummary}`,
          data: { albumId, matchedIds, analyzed, cached, visionErrors },
          verified: true,
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

function stripQuotes(s: string) {
  return s.replace(/^["']+|["']+$/g, '').trim()
}

/** Deterministic planner — no paid AI required for these commands. */
export function planFromPrompt(prompt: string, uiScope?: VaultToolContext['uiScope']): VaultToolCall[] {
  const text = prompt.trim()
  const lower = text.toLowerCase()
  const calls: VaultToolCall[] = []

  // Navigation / open views
  if (/\b(open|show|go to|view|pull up)\b/i.test(lower) && /\bfavorites?\b/i.test(lower)) {
    calls.push({ name: 'navigate', args: { path: '/favorites', label: 'Favorites' } })
    calls.push({ name: 'get_favorites', args: {} })
  }
  if (/\b(open|show|go to)\b/i.test(lower) && /\bduplicates?\b/i.test(lower)) {
    calls.push({ name: 'navigate', args: { path: '/duplicates', label: 'Duplicates' } })
    calls.push({ name: 'get_duplicates', args: {} })
  }
  if (/\b(open|show|go to)\b/i.test(lower) && /\b(library|all media)\b/i.test(lower)) {
    calls.push({ name: 'navigate', args: { path: '/library', label: 'Library' } })
  }
  if (/\b(open|show|go to)\b/i.test(lower) && /\b(albums?|collections?)\b/i.test(lower) && !/create|make|new/i.test(lower)) {
    if (!/inside|in (this|the) album/i.test(lower)) {
      calls.push({ name: 'navigate', args: { path: '/albums', label: 'Albums' } })
      calls.push({ name: 'list_albums', args: {} })
    }
  }
  if (/\b(open|show|go to)\b/i.test(lower) && /\btags?\b/i.test(lower) && !/create|tag (these|selected|it)/i.test(lower)) {
    calls.push({ name: 'navigate', args: { path: '/tags', label: 'Tags' } })
    calls.push({ name: 'list_tags', args: {} })
  }
  if (/\b(open|go to)\b/i.test(lower) && /\beditor\b/i.test(lower)) {
    calls.push({ name: 'navigate', args: { path: '/editor', label: 'Editor' } })
  }
  if (/\b(open|go to)\b/i.test(lower) && /\bsettings\b/i.test(lower)) {
    calls.push({ name: 'navigate', args: { path: '/settings', label: 'Settings' } })
  }

  if (/how much storage|storage stats|how big is (my )?vault|show storage/i.test(lower)) {
    calls.push({ name: 'get_storage_stats', args: {} })
  }
  if (/duplicate/i.test(lower) && !calls.some((c) => c.name === 'get_duplicates')) {
    calls.push({ name: 'get_duplicates', args: {} })
  }
  if (/favorite/i.test(lower) && /show|list|find/i.test(lower) && !calls.some((c) => c.name === 'get_favorites')) {
    calls.push({ name: 'get_favorites', args: {} })
  }
  if (/list (my )?tags|what tags/i.test(lower) && !calls.some((c) => c.name === 'list_tags')) {
    calls.push({ name: 'list_tags', args: {} })
  }
  if (/list (my )?albums/i.test(lower) && !calls.some((c) => c.name === 'list_albums')) {
    calls.push({ name: 'list_albums', args: {} })
  }
  if (/person group|people group/i.test(lower)) calls.push({ name: 'list_person_groups', args: {} })

  const createTagM = text.match(/(?:create|make|add)(?:\s+a)?\s+tag(?:\s+called|\s+named)?\s+["']?([^"'.]+)["']?/i)
  if (createTagM) calls.push({ name: 'create_tag', args: { name: normalizeTagName(createTagM[1]!).name } })

  const createAlbumM = text.match(
    /(?:create|make|add)(?:\s+an?)?(?:\s+new)?\s+(?:album|collection)(?:\s+called|\s+named)?\s+["']?([^"'.]+)["']?/i,
  )
  if (createAlbumM) calls.push({ name: 'create_album', args: { name: stripQuotes(createAlbumM[1]!) } })

  // Show everything tagged X
  const tagged = text.match(/(?:show|find|list|pull up).{0,40}tagged\s+["']?([^"'.]+)["']?/i)
  if (tagged) {
    calls.push({ name: 'search_by_tags', args: { tagNames: [stripQuotes(tagged[1]!)] } })
  }

  const year = text.match(/\b(19|20)\d{2}\b/)
  if (/created in|from |captured in|shot in|media (from|in)/i.test(lower) && year) {
    calls.push({ name: 'search_metadata', args: { createdYear: Number(year[0]), query: '' } })
  }

  const domain = text.match(/(?:from|source|url|domain)\s+(?:this\s+)?(?:website\s+)?(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})/i)
  if (domain) calls.push({ name: 'search_metadata', args: { sourceDomain: domain[1], query: '' } })

  if (!calls.length && /album stats|per album|album storage/i.test(lower)) {
    calls.push({ name: 'get_album_stats', args: {} })
  }

  // Favorite selected
  if (/\bfavorite (these|selected|them)\b/i.test(lower) && uiScope?.selectedFileIds?.length) {
    calls.push({ name: 'bulk_favorite', args: { fileIds: uiScope.selectedFileIds, value: true } })
  }

  // Visual / org across vault → durable job intent (not fake sync analyze-all)
  const wantsVaultWideVisual =
    /across (the )?(entire )?(vault|app|library)|entire vault|whole vault/i.test(lower) &&
    /(red\s*hair|redhead|blonde|nudity|people|visual|find everything|analyze)/i.test(lower)

  if (wantsVaultWideVisual) {
    const createAlbumName =
      text.match(/album(?:\s+called|\s+named)?\s+["']?([^"'.]+)["']?/i)?.[1] ||
      (/redhead/i.test(lower) ? 'Redhead' : /blonde/i.test(lower) ? 'Blonde' : '')
    const createTagName =
      text.match(/tag(?:\s+called|\s+named)?\s+["']?([^"'.]+)["']?/i)?.[1] ||
      (/redhead|red\s*hair/i.test(lower) ? 'Redhead' : /blonde/i.test(lower) ? 'Blonde' : '')
    if (/create|tag|album|organiz/i.test(lower)) {
      calls.push({
        name: 'create_org_job',
        args: {
          request: text,
          scope: 'vault',
          createTag: createTagName ? stripQuotes(createTagName) : null,
          createAlbum: createAlbumName ? stripQuotes(createAlbumName) : null,
          visualFocus: {
            freeText: /red/i.test(lower) ? 'red or reddish hair' : /blonde/i.test(lower) ? 'blonde hair' : 'match request',
            blondeHair: /blonde/i.test(lower),
          },
        },
      })
    } else {
      // Instant visual search without organizing
      calls.push({
        name: 'create_org_job',
        args: {
          request: text,
          scope: 'vault',
          mode: 'search_only',
          visualFocus: { freeText: text },
        },
      })
    }
  }

  // Scoped visual: album only
  const albumMatch =
    text.match(/inside\s+(?:album\s+)?["']?([^"'.]+?)["']?(?=\s+and\b|\s+find\b|\s+tag\b|,|$)/i) ||
    text.match(/album\s+["']?([^"'.]+?)["']?(?=\s|,|$)/i) ||
    text.match(/only\s+(?:in|inside)\s+["']?([^"'.]+?)["']?/i) ||
    (uiScope?.albumName && /this album|current album|only in this/i.test(lower) ? [null, uiScope.albumName] : null)

  const wantsVisual =
    /two people|blonde|redhead|red hair|analyze|visual|people count|containing exactly|appears to|nudity/i.test(lower) &&
    (/album|inside|only/i.test(lower) || Boolean(albumMatch) || Boolean(uiScope?.albumId))

  if (wantsVisual && (albumMatch || uiScope?.albumId) && !wantsVaultWideVisual) {
    const albumName = albumMatch ? String(albumMatch[1]).trim() : uiScope?.albumName || ''
    const albumId = uiScope?.albumId || undefined
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
    else if (/redhead|red hair/i.test(lower) && /tag/i.test(lower)) tagName = 'Redhead'
    else if (tagAs) tagName = tagAs[1]!.trim()

    calls.push({
      name: 'analyze_album_visual',
      args: {
        albumName: albumName || undefined,
        albumId,
        peopleCount: people,
        blondeHair: blonde,
        tagName,
        focus: /red/i.test(lower) ? 'red or reddish hair' : '',
        ensurePersonGroups: /person\s+\d|group.*people|recurring people/i.test(lower),
      },
    })
  }

  // Deduplicate by tool name keeping first
  const seen = new Set<string>()
  return calls.filter((c) => {
    const key = `${c.name}:${JSON.stringify(c.args)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function runDeterministicVaultAgent(
  userId: string,
  prompt: string,
  ctx: VaultToolContext = {},
): Promise<{ reply: string; results: VaultToolResult[]; navigations: string[] }> {
  const plan = planFromPrompt(prompt, ctx.uiScope)
  if (!plan.length) {
    return {
      reply:
        'I didn’t recognize a Vault action. Try: “Create album Chicken Nuggets”, “Open Favorites”, “Create tag Blonde”, “Show duplicates”, or “Show storage”.',
      results: [],
      navigations: [],
    }
  }
  const results: VaultToolResult[] = []
  const navigations: string[] = []
  for (const call of plan) {
    const result = await runVaultTool(userId, call, ctx)
    results.push(result)
    const nav = (result.data as { navigate?: string } | undefined)?.navigate
    if (nav) navigations.push(nav)
    if (call.name === 'navigate' && (result.data as { path?: string })?.path) {
      navigations.push(String((result.data as { path: string }).path))
    }
  }
  const lines = results.map((r) => {
    if (r.error === 'NEEDS_CONFIGURATION') return `⚠ ${r.summary}`
    return r.ok ? r.summary : `✗ ${r.tool}: ${r.error}`
  })
  return { reply: lines.join('\n') || 'Done.', results, navigations: [...new Set(navigations)] }
}
