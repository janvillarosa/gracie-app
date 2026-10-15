import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TripHeader } from '@components/trips/TripHeader'
import { lisbonTrip, rel } from './trips.helpers'

const members = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    user_id: `u${i}`,
    name: ['Jan', 'Mia', 'Zoe', 'Kai', 'Lu', 'Ed'][i],
    avatar_key: `a${i}`,
  }))

const header = (n: number, pending = 0) =>
  render(
    <TripHeader
      trip={lisbonTrip()}
      today={rel(0)}
      offline={false}
      pending={pending}
      persistFailed={false}
      deletedBy=""
      readOnlyOver={false}
      members={members(n)}
      notes={[]}
      onDismissNote={() => {}}
      onUnlock={() => {}}
      onRestore={() => {}}
      onMenu={() => {}}
      packing={{ label: 'Make a packing list', disabled: false }}
      daysOpen={false}
      onDaysOpen={() => {}}
      dayList={null}
    />,
  )

describe('the avatar stack in the trip header', () => {
  it('is one quiet image with one label, not a row of tab stops', () => {
    const { container } = header(2)
    const stack = screen.getByRole('img', { name: 'Shared with Jan and Mia' })
    expect(stack).toHaveClass('trip-avatars')
    // The individual faces are decoration; nothing in it takes focus.
    expect(stack.querySelectorAll('img[alt=""]')).toHaveLength(2)
    expect(container.querySelector('.trip-avatars [tabindex]')).toBeNull()
  })

  it('names three or more, with an Oxford-less "and"', () => {
    header(3)
    expect(screen.getByRole('img', { name: 'Shared with Jan, Mia and Zoe' })).toBeInTheDocument()
  })

  it('shows three faces and a +N disc beyond four members', () => {
    const { container } = header(6)
    expect(container.querySelectorAll('.trip-avatars img')).toHaveLength(3)
    expect(container.querySelector('.trip-avatar-more')).toHaveTextContent('+3')
    expect(
      screen.getByRole('img', { name: 'Shared with Jan, Mia, Zoe, Kai, Lu and Ed' }),
    ).toBeInTheDocument()
  })

  it('shows four faces, and no disc, at exactly four', () => {
    const { container } = header(4)
    expect(container.querySelectorAll('.trip-avatars img')).toHaveLength(4)
    expect(container.querySelector('.trip-avatar-more')).toBeNull()
  })

  it('sits on the date line, which is a sibling of the title row (so it can wrap whole)', () => {
    const { container } = header(2)
    const grid = container.querySelector('.list-header-grid') as HTMLElement
    const meta = grid.querySelector(':scope > .trip-metaline') as HTMLElement
    expect(meta).not.toBeNull()
    expect(meta.querySelector('.trip-dayline')).not.toBeNull()
    expect(meta.querySelector('.trip-avatars')).not.toBeNull()
  })
})

describe('the sync line', () => {
  afterEach(() => vi.useRealTimers())

  it('stays quiet for an everyday save, so the plan never jumps', () => {
    vi.useFakeTimers()
    header(2, 1)
    expect(screen.queryByText('Syncing…')).not.toBeInTheDocument()
    expect(document.querySelector('.trip-header-row')).toBeNull()
  })

  it('speaks up when a save is still waiting after two seconds', () => {
    vi.useFakeTimers()
    header(2, 1)
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByText('Syncing…')).toBeInTheDocument()
  })
})
