import React from 'react'
import { Button, Checkbox, List as AntList, Tag } from 'antd'
import { DotsSixVertical, Trash } from '@phosphor-icons/react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ListItem } from '@api/types'
import { InlineEditText } from '@components/InlineEditText'
import { getCategoryClass } from '@lib/category'

const SortableRow: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  const style = { transform: CSS.Transform.toString(transform), transition } as React.CSSProperties
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? 'sortable-row is-dragging' : 'sortable-row'}
    >
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
  // True the first time a row appears after the list has loaded (added here or by a housemate).
  entering?: boolean
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
  entering,
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

  // A new row stays "fresh" briefly: it slides in, gets a highlighter sweep, and its
  // category stamp lands when the server replies. Kept in state so the swap from the
  // placeholder to the saved item (same key) doesn't cut the entrance short.
  const [fresh, setFresh] = React.useState(!!entering)
  const rowRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (entering) setFresh(true)
  }, [entering])
  React.useEffect(() => {
    if (!fresh) return
    const li = rowRef.current?.closest('.ant-list-item')
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    li?.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
    const t = setTimeout(() => setFresh(false), 1600)
    return () => clearTimeout(t)
  }, [fresh])

  const body = (
    <div ref={rowRef} className={completed ? 'item-row item-row-completed' : 'item-row'}>
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
          <div
            className={completed ? 'item-body is-completed' : 'item-body'}
            style={{ display: 'flex', flexDirection: 'column' }}
          >
            <div className={it.completed ? 'item-desc is-done' : 'item-desc'}>{it.description}</div>
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
      className={fresh ? 'is-entering' : undefined}
      actions={[
        <Button
          key="del"
          type="text"
          danger
          className="item-delete"
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
