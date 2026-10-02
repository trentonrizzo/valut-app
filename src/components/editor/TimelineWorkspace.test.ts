// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyTimelinePayload, type EditorProjectPayload } from '../../lib/editor/projects'

vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }) }) },
}))
vi.mock('../../hooks/useDecryptedMediaSrc', () => ({ useDecryptedMediaSrc: () => ({ displayUrl: null, loading: false, failed: true }) }))
vi.mock('../files/VaultPhotoTile', () => ({ VaultPhotoTileMedia: () => React.createElement('span', null, 'thumb') }))
vi.mock('./EditorMediaPicker', () => ({
  EditorMediaPicker: ({ open, onAdd, maxSelect }: { open: boolean; onAdd: (files: unknown[]) => void; maxSelect: number }) => open
    ? React.createElement('button', { onClick: () => onAdd(maxSelect <= 4 ? [
      { id: 'file-1', user_id: 'user-1', file_name: 'clip.mov', file_url: 'r2://x', mime_type: 'video/quicktime', duration_ms: 10000 },
      { id: 'file-2', user_id: 'user-1', file_name: 'photo.jpg', file_url: 'r2://y', mime_type: 'image/jpeg' },
    ] : [{ id: 'file-1', user_id: 'user-1', file_name: 'clip.mov', file_url: 'r2://x', mime_type: 'video/quicktime', duration_ms: 10000 }]) }, 'Add selected media')
    : null,
}))

import { TimelineWorkspace } from './TimelineWorkspace'

afterEach(() => cleanup())

describe('timeline workspace integration', () => {
  it('adds picker media as an immutable source reference and persists real clip operations', async () => {
    let payload: EditorProjectPayload = emptyTimelinePayload()
    const writer = {
      status: 'Saved', error: null, draft: { dirty: false }, flush: vi.fn(),
      edit: vi.fn((document) => { payload = document.payload }),
    }
    const setPickerOpen = vi.fn()
    const view = render(React.createElement(MemoryRouter, null, React.createElement(TimelineWorkspace, {
      projectId: 'project-1', user: { id: 'user-1' }, session: null, title: 'Timeline', payload,
      writer, pickerOpen: true, setPickerOpen, onTitle: vi.fn(), onPayload: (next: EditorProjectPayload) => { payload = next },
    } as never)))
    fireEvent.click(screen.getByRole('button', { name: 'Add selected media' }))
    await waitFor(() => expect(screen.getByText('clip.mov')).toBeTruthy())
    expect(payload.timeline?.tracks[0]?.clips[0]).toMatchObject({ fileId: 'file-1', mediaType: 'video', sourceEnd: 10 })
    expect(writer.edit).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    expect(payload.timeline?.tracks[0]?.clips).toHaveLength(2)
    expect(payload.timeline?.tracks[0]?.clips.map((clip) => clip.fileId)).toEqual(['file-1', 'file-1'])
    expect(new Set(payload.timeline?.tracks[0]?.clips.map((clip) => clip.clipId)).size).toBe(2)
    view.unmount()
  })

  it('creates a visible mixed-media composition and saves it in the v3 timeline', async () => {
    let payload: EditorProjectPayload = emptyTimelinePayload()
    const writer = { status: 'Saved', error: null, draft: { dirty: false }, flush: vi.fn(), edit: vi.fn((document) => { payload = document.payload }) }
    const Harness = () => {
      const [open, setOpen] = React.useState(false)
      return React.createElement(TimelineWorkspace, { projectId: 'project-2', user: { id: 'user-1' }, title: 'Composition', payload, writer, pickerOpen: open, setPickerOpen: setOpen, onTitle: vi.fn(), onPayload: (next: EditorProjectPayload) => { payload = next } } as never)
    }
    render(React.createElement(MemoryRouter, null, React.createElement(Harness)))
    fireEvent.click(screen.getByRole('button', { name: '+ Composition' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add selected media' }))
    await waitFor(() => expect(screen.getByText('Composition · 2 media')).toBeTruthy())
    const clip = payload.timeline?.tracks[0]?.clips[0]
    expect(clip).toMatchObject({ mediaType: 'composition', fileId: null })
    expect(clip?.composition?.items.map((item) => item.fileId)).toEqual(['file-1', 'file-2'])
    expect(screen.getByRole('button', { name: 'Edit clip.mov' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit photo.jpg' })).toBeTruthy()
  })
})
