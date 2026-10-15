import { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Button,
  DetailGroup,
  NavRow,
  Sheet,
  SheetActions,
  SheetFooter,
  SheetIdentity,
  type SheetVariant,
} from '@components/ui'
import { setViewport } from './trips.helpers'
import { expectAtMostOneKey } from './ui.helpers'

const Demo = ({
  variant = 'sheet',
  dirty,
  onClosed,
}: {
  variant?: SheetVariant
  dirty?: boolean
  onClosed?: () => void
}) => {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        opener
      </button>
      <Sheet
        variant={variant}
        open={open}
        label="Demo"
        dirty={dirty}
        onClose={() => {
          setOpen(false)
          onClosed?.()
        }}
        // Slots are given out of order on purpose: the Sheet puts them in order.
        footer={<SheetFooter who="Added by Mia" onDelete={() => {}} />}
        details={
          <DetailGroup label="Details">
            <NavRow label="When" value="Thu 15" />
          </DetailGroup>
        }
        actions={
          <SheetActions>
            <Button kind="key">Do it</Button>
            <Button kind="quiet">Maybe</Button>
          </SheetActions>
        }
        identity={<SheetIdentity title="Demo" context="One line" />}
      />
    </>
  )
}

const openIt = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'opener' }))
  return screen.findByRole('dialog')
}

describe('Sheet, on a wide screen', () => {
  beforeEach(() => setViewport('desktop'))

  it('lays the four tiers out in order whatever order they are given', async () => {
    render(<Demo />)
    const dialog = await openIt()
    const order = [
      dialog.querySelector('.ui-sheet-identity'),
      dialog.querySelector('.ui-sheet-actions'),
      dialog.querySelector('.ui-detail-group'),
      dialog.querySelector('.ui-sheet-footer'),
    ] as HTMLElement[]
    for (const el of order) expect(el).not.toBeNull()
    for (let i = 1; i < order.length; i++)
      expect(
        order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
  })

  it('has at most one yellow key', async () => {
    render(<Demo />)
    expectAtMostOneKey(await openIt())
  })

  it('has a close key with a name, and no drag handle', async () => {
    render(<Demo />)
    const dialog = await openIt()
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(dialog.querySelector('.ui-sheet-handle')).toBeNull()
  })

  it('closes with the close key', async () => {
    const closed = vi.fn()
    render(<Demo onClosed={closed} />)
    await userEvent.click(within(await openIt()).getByRole('button', { name: 'Close' }))
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it('closes with Esc, once', async () => {
    const closed = vi.fn()
    render(<Demo onClosed={closed} />)
    await openIt()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it('closes when the scrim is pressed', async () => {
    const closed = vi.fn()
    render(<Demo onClosed={closed} />)
    await openIt()
    const wrap = document.querySelector('.ant-modal-wrap') as HTMLElement
    fireEvent.mouseDown(wrap)
    fireEvent.click(wrap)
    await waitFor(() => expect(closed).toHaveBeenCalled())
  })

  it('gives focus back to what opened it', async () => {
    render(<Demo />)
    const opener = screen.getByRole('button', { name: 'opener' })
    await userEvent.click(opener)
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('asks before throwing away work, and keeps the sheet when told to', async () => {
    const closed = vi.fn()
    render(<Demo dirty onClosed={closed} />)
    await openIt()
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByRole('heading', { name: 'Discard this?' })).toBeInTheDocument()
    expect(closed).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('dialog', { name: 'Demo' })).toBeInTheDocument()
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Demo' })).getByRole('button', { name: 'Close' }),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it('the confirm variant is a small dialog with one key', async () => {
    render(<Demo variant="confirm" />)
    const dialog = await openIt()
    expect(document.querySelector('.ui-dialog.is-confirm')).not.toBeNull()
    expectAtMostOneKey(dialog)
  })

  it('the chips variant hangs from its anchor as a popover and closes on Esc alone', async () => {
    const Chips = () => {
      const [open, setOpen] = useState(false)
      return (
        <Sheet
          variant="chips"
          open={open}
          onOpen={() => setOpen(true)}
          onClose={() => setOpen(false)}
          label="Pick"
          title="Pick"
          anchor={<button type="button">anchor</button>}
        >
          choices
        </Sheet>
      )
    }
    render(<Chips />)
    await userEvent.click(screen.getByRole('button', { name: 'anchor' }))
    expect(await screen.findByRole('dialog', { name: 'Pick' })).toBeInTheDocument()
    expect(document.querySelector('.ui-popover')).not.toBeNull()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('only the innermost of two open overlays answers Esc', async () => {
    const Two = () => {
      const [outer, setOuter] = useState(true)
      const [inner, setInner] = useState(true)
      return (
        <>
          <Sheet open={outer} onClose={() => setOuter(false)} label="Outer" title="Outer" />
          <Sheet
            variant="confirm"
            open={inner}
            onClose={() => setInner(false)}
            label="Inner"
            title="Inner"
          />
        </>
      )
    }
    render(<Two />)
    // (Ant gives every dialog the same title id under test, so find them by variant.)
    await waitFor(() => expect(document.querySelector('.ui-dialog.is-confirm')).not.toBeNull())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(document.querySelector('.ui-dialog.is-confirm')).toBeNull())
    expect(document.querySelector('.ui-dialog.is-sheet')).not.toBeNull()
  })
})

describe('Sheet, on a phone', () => {
  beforeEach(() => setViewport('phone'))

  it('is a bottom drawer with a drag handle, and swipes down to close', async () => {
    const closed = vi.fn()
    render(<Demo onClosed={closed} />)
    const dialog = await openIt()
    expect(dialog.closest('.ui-drawer')).not.toBeNull()
    expect(dialog.querySelector('.ui-sheet-handle')).not.toBeNull()
    const header = dialog.querySelector('.ui-sheet-header') as HTMLElement
    class Touch extends MouseEvent {
      pointerType = 'touch'
      pointerId = 1
    }
    const at = (type: string, y: number) =>
      fireEvent(header, new Touch(type, { bubbles: true, clientX: 10, clientY: y }))
    at('pointerdown', 100)
    at('pointerup', 140)
    expect(closed).not.toHaveBeenCalled()
    at('pointerdown', 100)
    at('pointerup', 200)
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it('closes with Esc and gives focus back', async () => {
    render(<Demo />)
    const opener = screen.getByRole('button', { name: 'opener' })
    await userEvent.click(opener)
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(opener).toHaveFocus())
  })
})
