import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Button,
  Chip,
  ChipGroup,
  DetailGroup,
  EmptyState,
  Field,
  NavRow,
  Note,
  Pip,
  Row,
  SectionLabel,
  SheetIdentity,
  Stamp,
  Switch,
} from '@components/ui'
import { setViewport } from './trips.helpers'

beforeEach(() => setViewport('desktop'))

describe('Button', () => {
  it('has three kinds, red for danger, and is a link when it has an href', async () => {
    const onClick = vi.fn()
    render(
      <>
        <Button kind="key" onClick={onClick}>
          Go
        </Button>
        <Button>Quiet</Button>
        <Button kind="text" danger>
          Delete
        </Button>
        <Button kind="key" href="https://maps.example/x">
          Open Maps
        </Button>
        <Button kind="text" iconOnly aria-label="Close" />
      </>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Go' })).toHaveClass('ui-btn', 'is-key')
    expect(screen.getByRole('button', { name: 'Quiet' })).toHaveClass('is-quiet')
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('is-text', 'is-danger')
    expect(screen.getByRole('link', { name: 'Open Maps' })).toHaveClass('ui-btn', 'is-key')
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('is-icon')
    // Never a submit button by accident.
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('type', 'button')
  })
})

describe('Chip', () => {
  it('is named "label, value", opens its picker and closes it from inside', async () => {
    render(
      <Chip label="Day" value="Thu 15" title="Day">
        {(close) => (
          <button type="button" onClick={close}>
            Fri 16
          </button>
        )}
      </Chip>,
    )
    const chip = screen.getByRole('button', { name: 'Day, Thu 15' })
    await userEvent.click(chip)
    await userEvent.click(await screen.findByRole('button', { name: 'Fri 16' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Fri 16' })).toBeNull())
  })
})

describe('ChipGroup', () => {
  it('is a named group of toggle buttons with one pressed', async () => {
    const pick = vi.fn()
    render(
      <ChipGroup
        label="Category"
        value="a"
        options={[
          { value: 'a', label: 'Sight' },
          { value: 'b', label: 'Food' },
        ]}
        onChange={pick}
      />,
    )
    const group = screen.getByRole('group', { name: 'Category' })
    expect(within(group).getByRole('button', { name: 'Sight' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(within(group).getByRole('button', { name: 'Food' }))
    expect(pick).toHaveBeenCalledWith('b')
  })
})

describe('NavRow and DetailGroup', () => {
  it('is a group of rows: label, value, chevron; a link, a button or a picker', async () => {
    const onClick = vi.fn()
    render(
      <MemoryRouter>
        <DetailGroup label="Details">
          <NavRow label="When" value="Thu 15" onClick={onClick} />
          <NavRow label="Place" value="Add a place" empty />
          <NavRow label="Packing list" value="Open" to="/app/lists/l1" />
          <NavRow
            label="Note"
            value="x"
            picker={{ title: 'Note', content: () => <p>picker body</p> }}
          />
        </DetailGroup>
      </MemoryRouter>,
    )
    const group = screen.getByRole('group', { name: 'Details' })
    await userEvent.click(within(group).getByRole('button', { name: 'When Thu 15' }))
    expect(onClick).toHaveBeenCalled()
    expect(within(group).getByText('Add a place')).toHaveClass('is-empty')
    expect(within(group).getByRole('link', { name: /Packing list/ })).toHaveAttribute(
      'href',
      '/app/lists/l1',
    )
    await userEvent.click(within(group).getByRole('button', { name: /^Note/ }))
    expect(await screen.findByText('picker body')).toBeInTheDocument()
  })
})

describe('Note', () => {
  it('is muted by default, and amber with a glyph (no side rule) when it warns', async () => {
    const onClick = vi.fn()
    render(
      <>
        <Note>Quiet words</Note>
        <Note tone="warn" onClick={onClick}>
          Two things overlap
        </Note>
      </>,
    )
    expect(screen.getByText('Quiet words').closest('.ui-note')).toHaveClass('is-muted')
    const warn = screen.getByRole('button', { name: 'Two things overlap' })
    expect(warn).toHaveClass('is-warn')
    expect(warn.querySelector('svg.ui-note-flag')).not.toBeNull()
    await userEvent.click(warn)
    expect(onClick).toHaveBeenCalled()
  })
})

describe('Field', () => {
  it('says its problem as an alert and marks itself invalid', () => {
    render(<Field aria-label="Title" error="Too long" />)
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Too long')
  })

  it('is a textarea when multiline', () => {
    render(<Field multiline aria-label="Notes" />)
    expect(screen.getByLabelText('Notes').tagName).toBe('TEXTAREA')
  })
})

describe('Switch', () => {
  it('toggles', async () => {
    const Demo = () => {
      const [on, setOn] = useState(false)
      return <Switch checked={on} onChange={setOn} aria-label="Show it" />
    }
    render(<Demo />)
    const sw = screen.getByRole('switch', { name: 'Show it' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'true')
  })
})

describe('Stamp, Pip, SectionLabel, EmptyState, Row', () => {
  it('stamp carries the category colours; a pip is decoration unless it has a label', () => {
    render(
      <>
        <Stamp category="food">Food</Stamp>
        <Stamp tone="used">Used</Stamp>
        <Pip category="sight" />
        <Pip category="food" label="Food" />
      </>,
    )
    expect(screen.getByText('Food', { selector: '.ui-stamp' })).toHaveClass('trip-cat-food')
    expect(screen.getByText('Used')).toHaveClass('is-used')
    expect(screen.getByRole('img', { name: 'Food' })).toHaveClass('ui-pip')
    expect(document.querySelectorAll('.ui-pip[aria-hidden="true"]')).toHaveLength(1)
  })

  it('section label is a heading; empty state has a title, words and an action', () => {
    render(
      <>
        <SectionLabel>This trip</SectionLabel>
        <EmptyState title="Nothing yet" action={<Button>Start</Button>}>
          Add the first one.
        </EmptyState>
      </>,
    )
    expect(screen.getByRole('heading', { name: 'This trip' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Nothing yet' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
  })

  it('row puts lead, time, title and trail in their columns, in that order', () => {
    render(
      <Row lead={<i data-testid="lead" />} time="12:30" trail={<b data-testid="trail" />}>
        Lunch
      </Row>,
    )
    const cells = [...(document.querySelector('.ui-row') as HTMLElement).children].map(
      (c) => c.className,
    )
    expect(cells).toEqual(['ui-row-lead', 'ui-row-time', 'ui-row-title', 'ui-row-trail'])
  })
})

describe('SheetIdentity', () => {
  it('is a heading unless the title is editable, and then it saves on blur', async () => {
    const onTitle = vi.fn()
    const { rerender } = render(<SheetIdentity title="Days" context="Pick one" />)
    expect(screen.getByRole('heading', { name: 'Days' })).toBeInTheDocument()
    rerender(<SheetIdentity title="Lunch" onTitle={onTitle} />)
    const field = screen.getByLabelText('Title')
    await userEvent.clear(field)
    await userEvent.type(field, 'Dinner')
    await userEvent.tab()
    expect(onTitle).toHaveBeenCalledWith('Dinner')
  })

  it('says a too-long title where it is typed and does not save it', async () => {
    const onTitle = vi.fn()
    render(<SheetIdentity title="Lunch" onTitle={onTitle} />)
    const field = screen.getByLabelText('Title')
    await userEvent.click(field)
    await userEvent.paste('x'.repeat(201))
    expect(await screen.findByRole('alert')).toHaveTextContent(/up to 200/)
    await userEvent.tab()
    expect(onTitle).not.toHaveBeenCalled()
  })
})
