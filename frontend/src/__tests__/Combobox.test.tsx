import React, { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Combobox } from '@components/ui'

const FRUIT = ['apple', 'apricot', 'avocado']

function Host({
  onPick = () => {},
  onSubmit = () => {},
  onHighlight,
  fruit = FRUIT,
}: {
  onPick?: (o: string) => void
  onSubmit?: (text: string) => void
  onHighlight?: (o: string | null) => void
  fruit?: string[]
}) {
  const [value, setValue] = useState('')
  const options = value ? fruit.filter((f) => f.startsWith(value)) : []
  const tail = options[0] ? options[0].slice(value.length) : ''
  return (
    <div className="add-bar">
      <Combobox
        options={options}
        getKey={(o) => o}
        getLabel={(o) => `fruit ${o}`}
        renderOption={(o) => <span>{o}</span>}
        onPick={onPick}
        onSubmitText={() => onSubmit(value)}
        onHighlight={onHighlight}
        query={value}
        ghost={tail}
        onAcceptGhost={() => setValue(value + tail)}
      >
        {({ input, ghost }) => (
          <>
            <input
              aria-label="fruit"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              {...input}
            />
            <div data-testid="ghost">{ghost}</div>
          </>
        )}
      </Combobox>
    </div>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Combobox', () => {
  it('wires the ARIA combobox pattern and announces the count politely', async () => {
    render(<Host />)
    const field = screen.getByRole('combobox', { name: 'fruit' })
    expect(field).toHaveAttribute('aria-expanded', 'false')
    await userEvent.type(field, 'a')
    expect(field).toHaveAttribute('aria-expanded', 'true')
    expect(field).toHaveAttribute('aria-controls', screen.getByRole('listbox').id)
    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(screen.getByRole('status')).toHaveTextContent('3 suggestions')
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    await userEvent.type(field, 'p')
    expect(screen.getByRole('status')).toHaveTextContent('2 suggestions')
    await userEvent.type(field, 'r')
    expect(screen.getByRole('status')).toHaveTextContent('1 suggestion')
  })

  it('never hijacks Enter: without a highlight it submits the typed text', async () => {
    const onPick = vi.fn()
    const onSubmit = vi.fn()
    render(<Host onPick={onPick} onSubmit={onSubmit} />)
    const field = screen.getByRole('combobox')
    await userEvent.type(field, 'ap')
    await userEvent.keyboard('{Enter}')
    expect(onPick).not.toHaveBeenCalled()
    expect(onSubmit).toHaveBeenCalledWith('ap')
  })

  it('moves with the arrows (the list rises, so Up goes deeper) and Enter picks the highlight', async () => {
    const onPick = vi.fn()
    const onHighlight = vi.fn()
    render(<Host onPick={onPick} onHighlight={onHighlight} />)
    const field = screen.getByRole('combobox')
    await userEvent.type(field, 'a')
    await userEvent.keyboard('{ArrowUp}{ArrowUp}')
    const opts = screen.getAllByRole('option')
    expect(opts[1]).toHaveAttribute('aria-selected', 'true')
    expect(field).toHaveAttribute('aria-activedescendant', opts[1].id)
    expect(onHighlight).toHaveBeenLastCalledWith('apricot')
    await userEvent.keyboard('{ArrowDown}')
    expect(field).toHaveAttribute('aria-activedescendant', opts[0].id)
    await userEvent.keyboard('{ArrowUp}{Enter}')
    expect(onPick).toHaveBeenCalledWith('apricot')
  })

  it('does not run past either end of the list', async () => {
    render(<Host />)
    const field = screen.getByRole('combobox')
    await userEvent.type(field, 'a')
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}')
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(field).not.toHaveAttribute('aria-activedescendant')
  })

  it('Esc closes the list until the next keystroke', async () => {
    render(<Host />)
    const field = screen.getByRole('combobox')
    await userEvent.type(field, 'a')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(field).toHaveAttribute('aria-expanded', 'false')
    await userEvent.type(field, 'p')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('offers the ghost only while nothing is highlighted, and Tab takes it', async () => {
    render(<Host />)
    const field = screen.getByRole('combobox')
    await userEvent.type(field, 'av')
    expect(screen.getByTestId('ghost')).toHaveTextContent('ocado')
    await userEvent.keyboard('{Tab}')
    expect(field).toHaveValue('avocado')
    await userEvent.clear(field)
    await userEvent.type(field, 'a')
    await userEvent.keyboard('{ArrowUp}')
    expect(screen.getByTestId('ghost')).toBeEmptyDOMElement()
  })

  it('lets Tab through when there is no ghost', async () => {
    render(<Host fruit={[]} />)
    const field = screen.getByRole('combobox')
    await userEvent.type(field, 'zz')
    const down = fireEvent.keyDown(field, { key: 'Tab' })
    expect(down).toBe(true)
  })

  it('picks a clicked option and keeps focus in the field', async () => {
    const onPick = vi.fn()
    render(<Host onPick={onPick} />)
    const field = screen.getByRole('combobox')
    await userEvent.type(field, 'a')
    await userEvent.click(screen.getByRole('option', { name: 'fruit avocado' }))
    expect(onPick).toHaveBeenCalledWith('avocado')
    expect(field).toHaveFocus()
  })

  it('fits the slips above a keyboard using visualViewport', async () => {
    const listeners: Record<string, () => void> = {}
    vi.stubGlobal('visualViewport', {
      offsetTop: 0,
      height: 300,
      addEventListener: (t: string, fn: () => void) => {
        listeners[t] = fn
      },
      removeEventListener: () => {},
    })
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(
      document.body as unknown as Element,
    )
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 500,
      bottom: 560,
    } as DOMRect)
    render(<Host />)
    await userEvent.type(screen.getByRole('combobox'), 'a')
    const list = screen.getByRole('listbox')
    // 560 bottom against a 300px visible area: 260px of the bar is under the keyboard.
    expect(list.style.bottom).toBe('calc(100% + 266px)')
    expect(list.style.maxHeight).toBe('228px')
    expect(Object.keys(listeners)).toEqual(expect.arrayContaining(['resize', 'scroll']))
    vi.restoreAllMocks()
  })

  it('clears the highlight on blur and on unmount', async () => {
    const onHighlight = vi.fn()
    const { unmount } = render(<Host onHighlight={onHighlight} />)
    const field = screen.getByRole('combobox')
    await userEvent.type(field, 'a')
    await userEvent.keyboard('{ArrowUp}')
    expect(onHighlight).toHaveBeenLastCalledWith('apple')
    fireEvent.blur(field)
    expect(onHighlight).toHaveBeenLastCalledWith(null)
    unmount()
    expect(onHighlight).toHaveBeenLastCalledWith(null)
  })
})
