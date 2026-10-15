import React, { useEffect, useRef, useState } from 'react'
import { Button, Drawer } from 'antd'
import { X } from '@phosphor-icons/react'
import { useDroppable } from '@dnd-kit/core'
import type { TripTodo } from '@api/tripTypes'
import { TransitionLink } from '@components/TransitionLink'
import type { Entry } from '@lib/trips/schedule'
import { EntryRows, type Shared } from './Spine'

export type TabId = 'plan' | 'ideas' | 'bookings'

type PanelProps = {
  title: string
  onClose: () => void
  // Desktop: a panel docked over the map. Elsewhere: a bottom sheet.
  desktop: boolean
  // No visible title: the content carries its own heading (the item sheets).
  bare?: boolean
  children: React.ReactNode
}

/** One surface for details, ideas, bookings and notes: docked over the map on desktop, a
 *  focus-trapped bottom sheet on touch screens. Rendered only while open. */
export const Panel: React.FC<PanelProps> = ({ title, onClose, desktop, bare, children }) => {
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!desktop) return
    const opener = document.activeElement as HTMLElement | null
    closeRef.current?.focus({ preventScroll: true })
    // Escape closes the panel wherever focus has moved to, unless something inside took it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus?.({ preventScroll: true })
    }
  }, [desktop])
  if (!desktop) {
    return (
      <Drawer
        open
        placement="bottom"
        height="88%"
        title={bare ? <span className="sr-only">{title}</span> : title}
        onClose={onClose}
        destroyOnClose
        className="trip-sheet-drawer"
        styles={{ body: { padding: 0 } }}
      >
        {children}
      </Drawer>
    )
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: a docked panel, not a modal <dialog>
    <div className="trip-overlay" role="dialog" aria-label={title}>
      <header className={bare ? 'trip-overlay-head is-bare' : 'trip-overlay-head'}>
        {bare ? <span className="sr-only">{title}</span> : <h2>{title}</h2>}
        <Button
          ref={closeRef}
          type="text"
          shape="circle"
          aria-label={`Close ${title.toLowerCase()}`}
          onClick={onClose}
          icon={<X />}
        />
      </header>
      <div className="trip-overlay-body">{children}</div>
    </div>
  )
}

type IdeasProps = {
  ideas: TripTodo[]
  shared: Shared
  moveOpenId: string | null
  selectedId: string | null
  enteringId: string | null
}

const MANY = 30

export const IdeasPanel: React.FC<IdeasProps> = ({
  ideas,
  shared,
  moveOpenId,
  selectedId,
  enteringId,
}) => {
  const [q, setQ] = useState('')
  const { setNodeRef, isOver } = useDroppable({ id: 'ideas' })
  const many = ideas.length > MANY
  const needle = q.trim().toLowerCase()
  const visible = needle
    ? ideas.filter((t) => t.title.toLowerCase().includes(needle))
    : many
      ? []
      : ideas
  const entries: Entry[] = visible.map((todo) => ({
    kind: 'todo',
    id: todo.todo_id,
    day: '',
    startMs: null,
    endMs: null,
    todo,
  }))
  return (
    <section
      ref={setNodeRef}
      className={isOver ? 'trip-ideas is-over' : 'trip-ideas'}
      aria-label="Ideas"
    >
      <p className="trip-hint">Places you might go. Move one onto a day when you’re ready.</p>
      {many && (
        <input
          className="trip-field trip-search"
          type="search"
          aria-label="Search ideas"
          placeholder={`Search ${ideas.length} ideas`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      {entries.length > 0 && (
        <EntryRows
          entries={entries}
          shared={shared}
          moveOpenId={moveOpenId}
          selectedId={selectedId}
          enteringId={enteringId}
          nowMs={0}
        />
      )}
      {!ideas.length && <p className="trip-empty-row">Nothing here yet</p>}
    </section>
  )
}

export const NotesPane: React.FC<{
  notes: string
  locked: boolean
  onSave: (v: string) => void
}> = ({ notes, locked, onSave }) => (
  <section className="trip-pane-body" aria-label="Notes">
    <textarea
      className="trip-field trip-notes"
      aria-label="Trip notes"
      rows={10}
      maxLength={16000}
      readOnly={locked}
      placeholder="Anything the House should know: visa rules, meeting points, the plan B."
      defaultValue={notes}
      onBlur={(e) => {
        if (e.target.value !== notes) onSave(e.target.value)
      }}
    />
  </section>
)

export const PackingPane: React.FC<{
  listId?: string | null
  online: boolean
  busy: boolean
  error: string
  onCreate: () => void
}> = ({ listId, online, busy, error, onCreate }) => (
  <section className="trip-pane-body" aria-label="Packing">
    {listId ? (
      <p>
        <TransitionLink to={`/app/lists/${listId}`} className="trip-link">
          Open the packing list
        </TransitionLink>
      </p>
    ) : (
      <>
        <p className="trip-empty-text">
          The packing list is a normal Bauhouse list, shared with the House.
        </p>
        <Button type="primary" shape="round" disabled={!online || busy} onClick={onCreate}>
          Create packing list
        </Button>
        {!online && <p className="trip-help">Needs a connection. Try again when you’re online.</p>}
        {error && (
          <p role="alert" className="trip-error">
            {error}
          </p>
        )}
      </>
    )}
  </section>
)
