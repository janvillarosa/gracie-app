import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { List as AntList } from 'antd'
import type { ListItem } from '@api/types'
import { ItemRow } from '@components/ItemRow'

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
    expect(screen.getByText(/Quantity:/)).toBeInTheDocument()
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
    expect(p.onDelete).toHaveBeenCalledWith(item)
    await userEvent.click(screen.getByText('Milk'))
    expect(p.onStartEdit).toHaveBeenCalledWith(item)
  })

  it('disables controls while saving', () => {
    renderRow({ saving: true })
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete item' })).toBeDisabled()
  })
})
