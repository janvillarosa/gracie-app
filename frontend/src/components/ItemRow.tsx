import React from 'react'
import { Button, Checkbox, List as AntList, Tag } from 'antd'
import { DotsSixVertical, Trash } from '@phosphor-icons/react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ListItem } from '@api/types'
import { InlineEditText } from '@components/InlineEditText'
import { getCategoryClass } from '@lib/category'

const SortableRow: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition } as React.CSSProperties
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? 'sortable-row is-dragging' : 'sortable-row'}
      {...listeners}
    >
      <span
        ref={setActivatorNodeRef}
        className="drag-handle"
        {...attributes}
        aria-label="Drag to reorder"
      >
        <DotsSixVertical />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}

const SWIPE_START = 10
const SWIPE_COMMIT = 88

// Swipe left on a touch screen to delete: the row follows the finger over a red tray, and
// letting go past the threshold deletes it. Mutates styles directly so a drag never
// re-renders the list.
function useSwipeToDelete(onCommit: () => void, disabled: boolean) {
  const slideRef = React.useRef<HTMLDivElement>(null)
  const trayRef = React.useRef<HTMLDivElement>(null)
  const gesture = React.useRef<{ x: number; y: number; id: number; active: boolean } | null>(null)

  const paint = (dx: number, animate: boolean) => {
    const slide = slideRef.current
    const tray = trayRef.current
    if (!slide || !tray) return
    slide.style.transition = animate ? 'transform 220ms var(--ease-out)' : 'none'
    slide.style.transform = dx ? `translateX(${dx}px)` : ''
    // Clip only while swiping so a lifted (dragged) row keeps its shadow.
    if (slide.parentElement) slide.parentElement.style.overflow = dx ? 'hidden' : ''
    tray.style.opacity = String(Math.min(1, Math.abs(dx) / SWIPE_COMMIT))
    tray.dataset.armed = Math.abs(dx) >= SWIPE_COMMIT ? 'true' : 'false'
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || e.pointerType !== 'touch') return
    gesture.current = { x: e.clientX, y: e.clientY, id: e.pointerId, active: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (!g.active) {
      if (Math.abs(dy) > SWIPE_START && Math.abs(dy) > Math.abs(dx)) {
        gesture.current = null
        return
      }
      if (dx < -SWIPE_START && Math.abs(dx) > Math.abs(dy) * 1.5) {
        g.active = true
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      } else return
    }
    paint(Math.min(0, dx + SWIPE_START), false)
  }
  const end = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    gesture.current = null
    if (!g.active) return
    const dx = Math.min(0, e.clientX - g.x + SWIPE_START)
    if (e.type === 'pointerup' && Math.abs(dx) >= SWIPE_COMMIT) {
      paint(-window.innerWidth, true)
      onCommit()
    } else paint(0, true)
  }

  return {
    slideRef,
    trayRef,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
    },
  }
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

  const swipe = useSwipeToDelete(() => onDelete(it), busy || variant === 'completed')
  const qtyText = [it.quantity, it.unit].filter(Boolean).join(' ')

  const body = (
    <div ref={rowRef} className={completed ? 'item-row item-row-completed' : 'item-row'}>
      <span ref={(el) => registerAnchor(it.item_id, el)} className="checkbox-anchor">
        <Checkbox
          checked={it.completed}
          onChange={() => onToggle(it)}
          disabled={busy}
          aria-label={`${it.completed ? 'Uncheck' : 'Check off'} ${it.description}`}
        />
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
          <div className={completed ? 'item-body is-completed' : 'item-body'}>
            <span className={it.completed ? 'item-desc is-done' : 'item-desc'}>
              {it.description}
            </span>
            {qtyText && <span className="item-qty">{qtyText}</span>}
          </div>
        )}
      </div>
      {showCategory && it.category && !editing && (
        <Tag className={`category-tag item-cat ${getCategoryClass(it.category)}`}>
          {it.category}
        </Tag>
      )}
      <Button
        type="text"
        className="item-delete"
        icon={<Trash />}
        aria-label="Delete item"
        title="Delete item"
        onClick={() => onDelete(it)}
        disabled={busy}
      />
    </div>
  )

  return (
    <AntList.Item className={fresh ? 'is-entering' : undefined}>
      <div className="item-swipe">
        <div ref={swipe.trayRef} className="swipe-tray" aria-hidden>
          <Trash weight="bold" />
        </div>
        <div ref={swipe.slideRef} className="item-slide" {...swipe.handlers}>
          {variant === 'sortable' ? <SortableRow id={it.item_id}>{body}</SortableRow> : body}
        </div>
      </div>
    </AntList.Item>
  )
})
