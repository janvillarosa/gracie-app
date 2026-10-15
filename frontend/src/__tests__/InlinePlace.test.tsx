import React, { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Place } from '../api/tripTypes'
import { InlinePlace } from '../components/ui'
import { placeInfo, setPlaceInfo } from '../lib/trips/places'

const Host: React.FC<{ start?: Place | null; onChange?: (p: Place | null) => void }> = ({
  start = null,
  onChange,
}) => {
  const [value, setValue] = useState<Place | null>(start)
  return (
    <InlinePlace
      value={value}
      label="Place"
      bias={{ lat: 38.7, lng: -9.1 }}
      onChange={(p) => {
        setValue(p)
        onChange?.(p)
      }}
    />
  )
}

describe('InlinePlace', () => {
  it('searches, shows the attribution under the slips, and picks a place with no name in it', async () => {
    const picked: Array<Place | null> = []
    render(<Host onChange={(p) => picked.push(p)} />)
    await userEvent.type(screen.getByRole('combobox', { name: 'Place' }), 'sé')
    const list = await screen.findByRole('listbox', { name: 'Places' })
    expect(within(list).getByText('Demo places (no Google key)')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('option', { name: /Sé de Lisboa/ }))
    await waitFor(() => expect(picked).toHaveLength(1))
    expect(picked[0]).toMatchObject({ source: 'google', place_id: 'demo:se' })
    expect(picked[0]).not.toHaveProperty('name')
    expect(picked[0]).not.toHaveProperty('address')
    // The chosen place reads as its name (from the session cache), with a way to clear it.
    expect(await screen.findByText('Sé de Lisboa')).toBeInTheDocument()
    expect(placeInfo('demo:se')?.name).toBe('Sé de Lisboa')
    await userEvent.click(screen.getByRole('button', { name: 'Remove place' }))
    expect(picked[picked.length - 1]).toBeNull()
  })

  it('says "Saved place" for a Google place whose name is not known (offline, or not fetched yet)', () => {
    render(<Host start={{ source: 'google', place_id: 'ChIJunknown', lat: 1, lng: 2 }} />)
    expect(screen.getByText('Saved place')).toBeInTheDocument()
  })

  it('shows the name as soon as the session cache learns it', async () => {
    render(<Host start={{ source: 'google', place_id: 'ChIJlate', lat: 1, lng: 2 }} />)
    expect(screen.getByText('Saved place')).toBeInTheDocument()
    setPlaceInfo('ChIJlate', { name: 'Time Out Market', locality: 'Lisboa' })
    expect(await screen.findByText('Time Out Market')).toBeInTheDocument()
  })

  it('closes with Esc and asks nothing for a single character', async () => {
    render(<Host />)
    await userEvent.type(screen.getByRole('combobox', { name: 'Place' }), 's')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await userEvent.type(screen.getByRole('combobox', { name: 'Place' }), 'é')
    await screen.findByRole('listbox', { name: 'Places' })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  })
})
