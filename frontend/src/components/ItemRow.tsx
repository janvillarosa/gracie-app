import React from 'react'
import { Button, Checkbox, List as AntList, Tag } from 'antd'
import { DotsSixVertical, Trash } from '@phosphor-icons/react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ListItem } from '@api/types'
import { InlineEditText } from '@components/InlineEditText'
import { getCategoryClass } from '@lib/category'

const SortableRow: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition } as React.CSSProperties
  return (
    <div ref={setNodeRef} style={style} className="sortable-row">
      <span className="drag-handle" {...attributes} {...listeners} aria-label="Drag to reorder">
        <DotsSixVertical />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}

export type ItemRowVariant = 'sortable' | 'plain' | 'completed'

type Props = {
  it: ListItem
  variant: ItemRowVariant
  showCategory: boolean
  editing: boolean
  saving: boolean
  onToggle: (it: ListItem) => void
  onDelete: (it: ListItem) => void
  onStartEdit: (it: ListItem) => void
  onSubmitEdit: (it: ListItem, next: string) => Promise<void> | void
  registerAnchor: (id: string, el: HTMLElement | null) => void
}

const editValue = (it: ListItem) =>
  `${it.quantity ? it.quantity + (it.unit ? ` ${it.unit}` : '') + ' ' : it.unit ? `${it.unit} ` : ''}${it.description}`

// Memoized so typing in the add bar or toggling one item doesn't re-render every row.
export const ItemRow = React.memo<Props>(function ItemRow({
  it,
  variant,
  showCategory,
  editing,
  saving,
  onToggle,
  onDelete,
  onStartEdit,
  onSubmitEdit,
  registerAnchor,
}) {
  const busy = saving || editing
  const completed = variant === 'completed'

  const body = (
    <div className={completed ? 'item-row item-row-completed' : 'item-row'}>
      <span ref={(el) => registerAnchor(it.item_id, el)} className="checkbox-anchor">
        <Checkbox checked={it.completed} onChange={() => onToggle(it)} disabled={busy} />
      </span>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: preserves existing click-to-edit behavior */}
      <div
        className="item-text"
        onClick={(e) => {
          e.stopPropagation()
          onStartEdit(it)
        }}
      >
        {editing ? (
          <InlineEditText
            value={editValue(it)}
            onSubmit={(val) => onSubmitEdit(it, val)}
            disabled={saving}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', opacity: completed ? 0.6 : 1 }}>
            <div
              style={{
                textDecoration: it.completed ? 'line-through' : 'none',
                fontWeight: 400,
                fontSize: '15px',
              }}
            >
              {it.description}
            </div>
            {(it.quantity || it.unit) && (
              <div className="qty-unit-line">
                <span className="qty-label">Quantity:</span> {it.quantity} {it.unit}
              </div>
            )}
            {showCategory && it.category && (
              <div style={{ marginTop: 2 }}>
                <Tag className={`category-tag ${getCategoryClass(it.category)}`}>{it.category}</Tag>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <AntList.Item
      actions={[
        <Button
          key="del"
          type="text"
          danger
          icon={<Trash />}
          aria-label="Delete item"
          title="Delete item"
          onClick={() => onDelete(it)}
          style={{ paddingInline: 8 }}
          disabled={busy}
        />,
      ]}
    >
      {variant === 'sortable' ? <SortableRow id={it.item_id}>{body}</SortableRow> : body}
    </AntList.Item>
  )
})
