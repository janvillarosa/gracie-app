import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { List as AntList } from 'antd'
import type { ListItem } from '@api/types'
import { ItemRow, reorderLock } from '@components/ItemRow'

const item: ListItem = {
  item_id: 'a',
  list_id: 'l',
  room_id: 'r',
  description: 'Milk',
  quantity: '2',
  unit: 'l',
  category: 'Dairy',
  completed: false,
  created_at: '',
  updated_at: '',
} as ListItem

const renderRow = (over: Partial<React.ComponentProps<typeof ItemRow>> = {}) => {
  const props = {
    it: item,
    variant: 'plain' as const,
    showCategory: true,
    editing: false,
    saving: false,
    onToggle: vi.fn(),
    onDelete: vi.fn(),
    onStartEdit: vi.fn(),
    onSubmitEdit: vi.fn(),
    registerAnchor: vi.fn(),
    ...over,
  }
  render(
    <AntList>
      <ItemRow {...props} />
    </AntList>,
  )
  return props
}

describe('ItemRow', () => {
  it('shows description, quantity and category', () => {
    renderRow()
    expect(screen.getByText('Milk')).toBeInTheDocument()
    expect(screen.getByText('Dairy')).toBeInTheDocument()
    expect(screen.getByText('2 l')).toBeInTheDocument()
  })

  it('hides the category when showCategory is false', () => {
    renderRow({ showCategory: false })
    expect(screen.queryByText('Dairy')).not.toBeInTheDocument()
  })

  it('fires toggle, delete and start-edit handlers', async () => {
    const p = renderRow()
    await userEvent.click(screen.getByRole('checkbox'))
    expect(p.onToggle).toHaveBeenCalledWith(item)
    await userEvent.click(screen.getByRole('button', { name: 'Delete item' }))
    // Delete waits for the row's exit animation before telling the parent.
    await waitFor(() => expect(p.onDelete).toHaveBeenCalledWith(item))
    await userEvent.click(screen.getByText('Milk'))
    expect(p.onStartEdit).toHaveBeenCalledWith(item)
  })

  it('disables controls while saving', () => {
    renderRow({ saving: true })
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete item' })).toBeDisabled()
  })

  describe('swipe to delete', () => {
    // jsdom has no PointerEvent; the swipe only listens to touch pointers.
    class TouchPointer extends MouseEvent {
      pointerType = 'touch'
      pointerId = 1
    }
    const finger = (el: Element, path: Array<[number, number]>) => {
      const [x0, y0] = path[0]
      fireEvent(el, new TouchPointer('pointerdown', { bubbles: true, clientX: x0, clientY: y0 }))
      for (const [x, y] of path.slice(1))
        fireEvent(el, new TouchPointer('pointermove', { bubbles: true, clientX: x, clientY: y }))
      const [xe, ye] = path[path.length - 1]
      fireEvent(el, new TouchPointer('pointerup', { bubbles: true, clientX: xe, clientY: ye }))
      act(() => {
        vi.runAllTimers()
      })
    }
    const slide = () => document.querySelector('.item-slide') as Element

    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
      reorderLock.active = false
    })

    it('deletes when released past the threshold', () => {
      const props = renderRow()
      finger(slide(), [
        [300, 20],
        [280, 20],
        [200, 20],
        [150, 20],
      ])
      expect(props.onDelete).toHaveBeenCalledTimes(1)
    })

    it('lets go of the delete when the finger slides off the row', () => {
      const props = renderRow()
      finger(slide(), [
        [300, 20],
        [280, 20],
        [150, 20],
        [150, 90],
      ])
      expect(props.onDelete).not.toHaveBeenCalled()
    })

    it('never deletes a row that is lifted for reordering', () => {
      const props = renderRow()
      reorderLock.active = true
      finger(slide(), [
        [300, 20],
        [280, 20],
        [150, 20],
      ])
      expect(props.onDelete).not.toHaveBeenCalled()
    })
  })
})
