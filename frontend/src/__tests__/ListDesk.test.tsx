import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eggs, resetWindow, setupListPage, setWide } from './listDesk.helpers'

const produce = [
  { description: 'Oregano', category: 'Produce' },
  { description: 'Dill plant', category: 'Produce' },
  { description: 'Oat milk', category: 'Dairy', quantity: '2 L' },
]

beforeEach(() => {
  localStorage.removeItem('gracie_group_by_cat')
})
afterEach(() => {
  resetWindow()
})

const side = () => screen.findByRole('complementary', { name: 'Butler and notes' })

describe('the list desk (1024px and wider)', () => {
  it('shows the list and the side pane with no tabs', async () => {
    await setupListPage({
      wide: true,
      notes: 'Bread on Saturday',
      suggestions: [eggs],
      items: produce,
    })
    const pane = await side()
    expect(screen.queryByRole('tab', { name: /notes/i })).toBeNull()
    expect(within(pane).getByRole('heading', { name: 'Butler' })).toBeInTheDocument()
    expect(await within(pane).findByText('Eggs')).toBeInTheDocument()
    expect(within(pane).getByRole('heading', { name: 'Notes' })).toBeInTheDocument()
    expect(within(pane).getByRole('textbox')).toHaveValue('Bread on Saturday')
    expect(within(pane).getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('keeps the phone layout below 1024px', async () => {
    await setupListPage({ wide: false, notes: 'Bread', suggestions: [eggs], items: produce })
    expect(screen.getByRole('tab', { name: /notes/i })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Butler and notes' })).toBeNull()
    expect(document.documentElement).not.toHaveClass('desk-shell')
  })

  it('says "Nothing due yet." when Butler has nothing to show', async () => {
    await setupListPage({ wide: true, suggestions: [], items: produce })
    const pane = await side()
    expect(await within(pane).findByText('Nothing due yet.')).toBeInTheDocument()
  })

  it('hides Butler when it is off for the House, and Notes stays', async () => {
    await setupListPage({ wide: true, mode: 'off', items: produce })
    const pane = await side()
    expect(within(pane).getByRole('heading', { name: 'Notes' })).toBeInTheDocument()
    expect(within(pane).queryByRole('heading', { name: 'Butler' })).toBeNull()
    expect(within(pane).queryByText('Nothing due yet.')).toBeNull()
  })

  it('lays every Butler slip out at once, where a phone shows only the front one', async () => {
    const route = [
      { item_id: 'it-0', key: 'oregano', spot: 0.25, done: false },
      { item_id: 'it-1', key: 'dill plant', spot: 0.5, done: false },
    ]
    const { container, unmount } = await setupListPage({
      wide: true,
      suggestions: [eggs],
      items: produce,
      route,
    })
    const pane = await side()
    expect(await within(pane).findByRole('region', { name: 'Up next' })).toBeInTheDocument()
    expect(await within(pane).findByRole('region', { name: 'Suggestion' })).toBeInTheDocument()
    expect(container.querySelectorAll('.slip-stack-peek')).toHaveLength(0)
    unmount()

    await setupListPage({ wide: false, suggestions: [eggs], items: produce, route })
    expect(await screen.findByRole('region', { name: 'Up next' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Suggestion' })).toBeNull()
  })

  it('fixes the window on the desk and frees it on leaving, or on narrowing', async () => {
    const { unmount } = await setupListPage({ wide: true, items: produce })
    await side()
    expect(document.documentElement).toHaveClass('desk-shell')
    setWide(false)
    await waitFor(() => expect(document.documentElement).not.toHaveClass('desk-shell'))
    setWide(true)
    await waitFor(() => expect(document.documentElement).toHaveClass('desk-shell'))
    unmount()
    expect(document.documentElement).not.toHaveClass('desk-shell')
  })

  it('keeps unsaved notes across a resize', async () => {
    const { user } = await setupListPage({ wide: true, notes: 'Bread', items: produce })
    const pane = await side()
    const box = within(pane).getByRole('textbox')
    await user.click(box)
    await user.keyboard(' and milk')
    expect(box).toHaveValue('Bread and milk')

    setWide(false)
    await user.click(await screen.findByRole('tab', { name: /notes/i }))
    expect(screen.getByRole('textbox')).toHaveValue('Bread and milk')

    setWide(true)
    expect(within(await side()).getByRole('textbox')).toHaveValue('Bread and milk')
  })

  it('"/" jumps to the composer', async () => {
    const { user } = await setupListPage({ wide: true, items: produce })
    await side()
    await user.keyboard('/')
    expect(document.activeElement?.id).toBe('list-add-input')
  })

  it('an empty list focuses the composer on load, on the desk only', async () => {
    const { unmount } = await setupListPage({ wide: true, items: [] })
    await waitFor(() => expect(document.activeElement?.id).toBe('list-add-input'))
    unmount()
    await setupListPage({ wide: false, items: [] })
    await screen.findByText(/No items yet/)
    expect(document.activeElement?.id).not.toBe('list-add-input')
  })

  it('a category section folds and unfolds', async () => {
    localStorage.setItem('gracie_group_by_cat', 'true')
    const { user } = await setupListPage({ wide: true, items: produce })
    const head = await screen.findByRole('button', { name: /^Produce/ })
    expect(head).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Oregano')).toBeInTheDocument()
    await user.click(head)
    expect(head).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Oregano')).toBeNull()
    expect(screen.getByText('Oat milk')).toBeInTheDocument()
    await user.click(head)
    expect(screen.getByText('Oregano')).toBeInTheDocument()
  })
})
