// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { setPrivacyCover } from '../../lib/privacyCover'
import { PrivacyScreen } from './PrivacyScreen'

describe('Privacy screen', () => {
  afterEach(() => setPrivacyCover(false))

  it('covers the vault without showing a filename', () => {
    setPrivacyCover(true)
    render(React.createElement(PrivacyScreen))
    const dialog = screen.getByRole('dialog', { name: 'Privacy Screen' })
    expect(dialog.textContent).toContain('Your Vault is hidden.')
    expect(dialog.textContent).not.toMatch(/\.mp4|\.jpg|filename|album/i)
    fireEvent.click(screen.getByRole('button', { name: 'Show Vault' }))
    expect(screen.queryByRole('dialog', { name: 'Privacy Screen' })).toBeNull()
  })
})
