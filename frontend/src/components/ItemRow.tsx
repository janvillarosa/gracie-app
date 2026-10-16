import React from 'react'
import { Button } from '@components/ui'
import { Checkbox, List as AntList, Tag } from 'antd'
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
        <DotsSixVertical weight="bold" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}

const SWIPE_START = 10
const SWIPE_COMMIT = 88
// Sliding the finger this far off the row (up or down) mid-swipe cancels the delete.
const SWIPE_DRIFT = 40

// One finger, one gesture. Set while a row is lifted for reordering (ListPage's DndContext
// sets and clears it): a lifted row moves, it never arms a delete. The reverse is handled
// by the long-press tolerance in ListPage, which is tighter than SWIPE_START, so any
// sideways move that could start a swipe has already cancelled the pending lift.
export const reorderLock = { active: false }

// Swipe left on a touch screen to delete: the row follows the finger over a red tray, and
// letting go past the threshold deletes it. Dragging back, or sliding the finger off the
// row, sends it home instead. Mutates styles directly so a drag never re-renders the list.
export function useSwipeToDelete(onCommit: () => void, disabled: boolean) {
  const slideRef = React.useRef<HTMLDivElement>(null)
  const trayRef = React.useRef<HTMLDivElement>(null)
  const gesture = React.useRef<{ x: number; y: number; id: number; active: boolean } | null>(null)

  const paint = (dx: number, animate: boolean) => {
    const slide = slideRef.current
    const tray = trayRef.current
    if (!slide || !tray) return
    slide.style.transition = animate ? 'transform 220ms var(--ease-out)' : 'none'
    slide.style.transform = dx ? `translateX(${dx}px)` : ''
    // Lifts the paper (its shadow falls on the tray) only while it's off its resting place
    slide.dataset.swiping = dx ? 'true' : 'false'
    // Clip only while swiping so a lifted (dragged) row keeps its shadow.
    if (slide.parentElement) slide.parentElement.style.overflow = dx ? 'hidden' : ''
    // The tray goes solid red almost at once (a slow fade reads as muddy pink); the icon
    // carries the progress toward the delete point instead, via --swipe-p.
    tray.style.opacity = String(Math.min(1, Math.abs(dx) / 16))
    tray.style.setProperty('--swipe-p', String(Math.min(1, Math.abs(dx) / SWIPE_COMMIT)))
    const armed = Math.abs(dx) >= SWIPE_COMMIT
    if (armed && tray.dataset.armed !== 'true') navigator.vibrate?.(8)
    tray.dataset.armed = armed ? 'true' : 'false'
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || e.pointerType !== 'touch') return
    gesture.current = { x: e.clientX, y: e.clientY, id: e.pointerId, active: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    // The row was lifted for reordering: this touch belongs to the drag now.
    if (reorderLock.active) {
      if (g.active) paint(0, true)
      gesture.current = null
      return
    }
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (g.active && Math.abs(dy) > SWIPE_DRIFT) {
      // Wandered off the row: treat it like dragging off a button and let go of the delete.
      paint(0, true)
      gesture.current = null
      return
    }
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

  // Deleting plays a short exit (the row clears away and the gap closes) before the parent
  // removes it, so the list never jumps. Reduced motion, or no matchMedia, deletes at once.
  const liRef = React.useRef<HTMLDivElement>(null)
  const [leaving, setLeaving] = React.useState(false)
  const leave = React.useCallback(() => {
    const reduce =
      !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return onDelete(it)
    const li = liRef.current
    if (li) li.style.setProperty('--row-h', `${li.offsetHeight}px`)
    setLeaving(true)
    setTimeout(() => onDelete(it), 260)
  }, [it, onDelete])

  const swipe = useSwipeToDelete(leave, busy || leaving || variant === 'completed')
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
        kind="text"
        iconOnly
        className="item-delete"
        icon={<Trash />}
        aria-label="Delete item"
        title="Delete item"
        onClick={leave}
        disabled={busy || leaving}
      />
    </div>
  )

  return (
    <AntList.Item
      ref={liRef}
      className={
        [fresh && 'is-entering', leaving && 'is-leaving'].filter(Boolean).join(' ') || undefined
      }
    >
      <div className="item-swipe">
        <div ref={swipe.trayRef} className="swipe-tray" aria-hidden>
          <Trash weight="bold" className="swipe-tray-icon" />
        </div>
        <div ref={swipe.slideRef} className="item-slide" {...swipe.handlers}>
          {variant === 'sortable' ? <SortableRow id={it.item_id}>{body}</SortableRow> : body}
        </div>
      </div>
    </AntList.Item>
  )
})
