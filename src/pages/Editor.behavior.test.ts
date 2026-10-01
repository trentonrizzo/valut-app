// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => {
  const payload = {
    version: 2 as const,
    scenes: [{
      id: 'scene-1', layout: '1' as const,
      layers: [{ id: 'layer-1', fileId: 'missing-file', kind: 'video' as const, trimStart: 0, trimEnd: null, photoDuration: 3, speed: 1, muted: true, volume: 1, objectFit: 'cover' as const, zoom: 1, panX: 0, panY: 0 }],
    }],
    activeSceneId: 'scene-1', audioMasterLayerId: null,
  }
  const draft = { document: { id: 'project-1', title: 'Existing project', payload }, baseUpdatedAt: '2026-01-01T00:00:00Z', dirty: false }
  const listeners = new Set<() => void>()
  const writer = {
    draft, status: 'Saved', error: null,
    edit: vi.fn((document) => { draft.document = structuredClone(document); draft.dirty = true; writer.status = 'Saving'; listeners.forEach(fn => fn()) }),
    flush: vi.fn(async () => { draft.dirty = false; writer.status = 'Saved'; listeners.forEach(fn => fn()) }),
    subscribe: vi.fn((fn) => { listeners.add(fn); return () => listeners.delete(fn) }),
  }
  return { payload, draft, writer, loadProjectWriter: vi.fn(async () => writer), showToast: vi.fn(), user: { id: 'user-1' }, session: { access_token: 'test' } }
})

vi.mock('../context/useAuth', () => ({ useAuth: () => ({ user: fixture.user, session: fixture.session }) }))
vi.mock('../context/useToast', () => ({ useToast: () => ({ showToast: fixture.showToast }) }))
vi.mock('../context/useVault', () => ({ useVault: () => ({ masterKey: null }) }))
vi.mock('../lib/editor/session', () => ({ loadProjectWriter: fixture.loadProjectWriter, writerFor: vi.fn() }))
vi.mock('../lib/editor/persistence', () => ({ storeDraft: vi.fn() }))
vi.mock('../lib/editor/projects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/editor/projects')>()
  return {
    ...actual,
    exportSupported: () => ({ canvas: false, mediaRecorder: false }),
    listEditorProjects: vi.fn(async () => [{ id: 'project-1', user_id: 'user-1', title: 'Existing project', kind: 'video', payload: fixture.payload, created_at: '2026-01-01', updated_at: '2026-01-01' }]),
    deleteEditorProject: vi.fn(), duplicateEditorProject: vi.fn(),
  }
})
vi.mock('../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }) }) },
}))
vi.mock('../hooks/useDecryptedMediaSrc', () => ({ useDecryptedMediaSrc: () => ({ displayUrl: null, loading: false, failed: true }) }))
vi.mock('../components/editor/EditorMediaPicker', () => ({ EditorMediaPicker: () => null }))
vi.mock('../components/editor/EditorTimeline', () => ({ EditorTimeline: () => null }))
vi.mock('../lib/editor/exportToVault', () => ({ exportEditorCollageToVault: vi.fn() }))

import { Editor } from './Editor'

function app(path = '/editor/project-1') {
  return React.createElement(MemoryRouter, { initialEntries: [path] },
    React.createElement(Routes, null,
      React.createElement(Route, { path: '/editor', element: React.createElement('p', null, 'Project list') }),
      React.createElement(Route, { path: '/editor/:projectId', element: React.createElement(Editor) }),
    ),
  )
}

beforeEach(() => {
  fixture.writer.edit.mockClear(); fixture.writer.flush.mockClear(); fixture.loadProjectWriter.mockClear(); fixture.showToast.mockClear()
  fixture.draft.document.title = 'Existing project'; fixture.draft.dirty = false; fixture.writer.status = 'Saved'; fixture.writer.error = null
})
afterEach(() => cleanup())

describe('editor project route behavior', () => {
  it('opens the exact routed project without writing and preserves a missing source reference', async () => {
    render(app())
    expect(await screen.findByDisplayValue('Existing project')).toBeTruthy()
    expect(fixture.loadProjectWriter).toHaveBeenCalledWith('user-1', 'project-1')
    expect(fixture.writer.edit).not.toHaveBeenCalled()
    expect(await screen.findByText('Source unavailable. Its project reference and edits are preserved.')).toBeTruthy()
    expect(fixture.draft.document.payload.scenes[0]!.layers[0]!.fileId).toBe('missing-file')
  })

  it('journals an edit before immediate navigation and reloads the same stable project id', async () => {
    const first = render(app())
    const title = await screen.findByLabelText('Project name')
    fireEvent.change(title, { target: { value: 'Renamed now' } })
    expect(fixture.writer.edit).toHaveBeenCalledWith(expect.objectContaining({ id: 'project-1', title: 'Renamed now' }))
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }))
    expect(fixture.writer.flush).toHaveBeenCalled()
    expect(await screen.findByText('Project list')).toBeTruthy()
    first.unmount()

    render(app('/editor/project-1'))
    await waitFor(() => expect(screen.getByDisplayValue('Renamed now')).toBeTruthy())
    expect(fixture.loadProjectWriter).toHaveBeenLastCalledWith('user-1', 'project-1')
  })
})
