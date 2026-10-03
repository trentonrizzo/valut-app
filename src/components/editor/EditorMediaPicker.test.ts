// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileRow } from '../../types/media'

const storage = (() => {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key) },
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
})()
Object.defineProperty(window, 'localStorage', { configurable: true, value: storage })

const mocks = vi.hoisted(() => ({
  listMediaPage: vi.fn(),
  listTags: vi.fn().mockResolvedValue([]),
  albums: [{ id: 'album-1', name: 'Trip', parent_album_id: null, is_protected: false }],
}))

vi.mock('../../lib/mediaQueries', () => ({ listMediaPage: mocks.listMediaPage }))
vi.mock('../../lib/tags', () => ({ listTags: mocks.listTags }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: mocks.albums, error: null }) }) }) }),
  },
}))
vi.mock('../../lib/locks', () => ({ canRevealLockedContent: () => true }))
vi.mock('../../lib/albumPin', () => ({ albumViewAllowed: () => true }))
vi.mock('../files/VaultPhotoTile', () => ({ VaultPhotoTileMedia: ({ file }: { file: FileRow }) => React.createElement('span', null, file.file_name) }))
vi.mock('../../hooks/useDecryptedMediaSrc', () => ({ useDecryptedMediaSrc: () => ({ displayUrl: 'blob:test', loading: false, failed: false }) }))

import { EditorMediaPicker } from './EditorMediaPicker'

function row(id: string, name: string): FileRow {
  return {
    id, user_id: 'user-1', album_id: null, file_name: name, file_url: `r2://${id}`, created_at: '2026-01-01T00:00:00Z',
    file_size_bytes: 1, purpose: 'content', is_encrypted: false, mime_type: 'image/jpeg', storage_key: id,
    storage_provider: 'r2', upload_status: 'ready', checksum: null, width: 1, height: 1, duration_ms: null,
    captured_at: null, captured_at_local: null, captured_at_offset: null, captured_at_source: null, favorite: false, rating: null, thumbnail_key: null, poster_key: null, encryption_version: 0,
    wrapped_dek: null, encryption_chunk_size: null, metadata_json: {}, deleted_at: null, locked: false,
    stored_size_bytes: 1, storage_integrity: 'ready', membership_snapshot: null, original_filename: name,
    source_url: null, description: null, content_hash: null, hash_algo: null, hash_status: null,
  }
}

const first = row('first', 'first.jpg')
const second = row('second', 'second.jpg')
const album = row('album', 'album.jpg')

beforeEach(() => {
  localStorage.clear()
  mocks.listMediaPage.mockReset().mockImplementation(async ({ filters }: { filters: { search: string; albumId: string | null } }) => ({
    rows: filters.albumId ? [album] : filters.search === 'second' ? [second] : [first],
    nextCursor: null,
  }))
})
afterEach(() => { cleanup(); document.body.style.overflow = '' })

describe('editor media browser behavior', () => {
  it('keeps selected records across searches and album navigation, then adds every selection', async () => {
    const onAdd = vi.fn()
    render(React.createElement(EditorMediaPicker, { open: true, userId: 'user-1', onClose: vi.fn(), onAdd, maxSelect: 4 }))
    fireEvent.click(await screen.findByRole('button', { name: 'Select first.jpg' }))

    fireEvent.change(screen.getByLabelText('Search filenames and tags'), { target: { value: 'second' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Select second.jpg' }))

    fireEvent.change(screen.getByLabelText('Media source'), { target: { value: 'albums' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Trip' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Select album.jpg' }))

    expect(screen.getByText('3 selected · 4 available')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add 3' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd.mock.calls[0]![0].map((file: FileRow) => file.id)).toEqual(['first', 'second', 'album'])
  })

  it('dismisses with Escape and ignores an older search response', async () => {
    let resolveSlow!: (value: { rows: FileRow[]; nextCursor: null }) => void
    const slow = new Promise<{ rows: FileRow[]; nextCursor: null }>((resolve) => { resolveSlow = resolve })
    mocks.listMediaPage.mockImplementation(({ filters }: { filters: { search: string } }) => {
      if (filters.search === 'slow') return slow
      return Promise.resolve({ rows: filters.search === 'fast' ? [second] : [first], nextCursor: null })
    })
    const onClose = vi.fn()
    render(React.createElement(EditorMediaPicker, { open: true, userId: 'user-1', onClose, onAdd: vi.fn() }))
    await screen.findByRole('button', { name: 'Select first.jpg' })
    fireEvent.change(screen.getByLabelText('Search filenames and tags'), { target: { value: 'slow' } })
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)))
    fireEvent.change(screen.getByLabelText('Search filenames and tags'), { target: { value: 'fast' } })
    await screen.findByRole('button', { name: 'Select second.jpg' })
    resolveSlow({ rows: [album], nextCursor: null })
    await act(async () => { await slow })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Select album.jpg' })).toBeNull())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
