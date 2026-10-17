import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { IconPicker } from '@components/IconPicker'
import { ListIconDisc, TripIconDisc } from '@components/IconDiscs'
import { IconDisc } from '@components/ui'
import {
  ICON_EMOJI,
  ICON_GROUND,
  LIST_ICONS,
  TRIP_ICONS,
  TRIP_ICON_EMOJI,
  TRIP_ICON_GROUND,
  toGround,
  toTripGround,
} from '../icons'

describe('icon grounds', () => {
  it('give every list icon and every trip icon a ground and an emoji', () => {
    for (const i of LIST_ICONS) {
      expect(ICON_EMOJI[i]).toBeTruthy()
      expect(['blue', 'yellow', 'red']).toContain(ICON_GROUND[i])
    }
    for (const i of TRIP_ICONS) {
      expect(TRIP_ICON_EMOJI[i]).toBeTruthy()
      expect(['blue', 'yellow', 'red']).toContain(TRIP_ICON_GROUND[i])
    }
  })

  it('fall back like the emoji do: no list icon is no ground, an unknown trip icon is the suitcase', () => {
    expect(toGround(undefined)).toBeUndefined()
    expect(toGround('APPLE')).toBe('blue')
    expect(toTripGround(undefined)).toBe(TRIP_ICON_GROUND.SUITCASE)
    expect(toTripGround('NOPE')).toBe(TRIP_ICON_GROUND.SUITCASE)
    expect(toTripGround('PLANE')).toBe('yellow')
  })
})

describe('IconDisc', () => {
  it('is a decorative round disc: aria-hidden, the emoji inside, the ground as a class', () => {
    const { container } = render(<IconDisc glyph="🍎" ground="blue" />)
    const d = container.querySelector('.icon-disc') as HTMLElement
    expect(d.tagName).toBe('SPAN')
    expect(d).toHaveAttribute('aria-hidden', 'true')
    expect(d).toHaveTextContent('🍎')
    expect(d).toHaveClass('is-blue')
    expect(d).not.toHaveClass('is-sm')
  })

  it('takes a size, a blank state and no ground', () => {
    const { container } = render(<IconDisc glyph="-" size="sm" blank />)
    const d = container.querySelector('.icon-disc') as HTMLElement
    expect(d).toHaveClass('is-sm', 'is-blank')
    expect(d.className).not.toMatch(/is-(blue|yellow|red)/)
  })

  it('becomes a named button when it has a click handler', async () => {
    const onClick = vi.fn()
    render(<IconDisc glyph="🧳" ground="blue" label="Change icon" onClick={onClick} />)
    await userEvent.click(screen.getByRole('button', { name: 'Change icon' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('draws a list icon and a trip icon from their maps', () => {
    const { container } = render(
      <>
        <ListIconDisc icon="BROCCOLI" />
        <TripIconDisc icon="MOUNTAIN" />
        <TripIconDisc />
      </>,
    )
    const [a, b, c] = Array.from(container.querySelectorAll('.icon-disc'))
    expect([a.textContent, a.className]).toEqual(['🥦', expect.stringContaining('is-red')])
    expect([b.textContent, b.className]).toEqual(['🏔️', expect.stringContaining('is-yellow')])
    expect([c.textContent, c.className]).toEqual(['🧳', expect.stringContaining('is-blue')])
  })
})

describe('IconPicker', () => {
  it('shows each icon on its disc, small, inside a tile', () => {
    const { container } = render(<IconPicker onChange={() => {}} />)
    const discs = Array.from(container.querySelectorAll('.ui-choice .icon-disc.is-sm'))
    expect(discs.map((d) => d.textContent)).toEqual(LIST_ICONS.map((i) => ICON_EMOJI[i]))
    expect(discs.every((d) => /is-(blue|yellow|red)/.test(d.className))).toBe(true)
  })
})
