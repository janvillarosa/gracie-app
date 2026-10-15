import React, { useEffect, useRef, useState } from 'react'
import { Button, Drawer, Dropdown } from 'antd'
import { DotsThree, X } from '@phosphor-icons/react'
import { useDroppable } from '@dnd-kit/core'
import type { MenuProps } from 'antd'
import type { TripTodo } from '@api/tripTypes'
import { TransitionLink } from '@components/TransitionLink'
import type { Entry } from '@lib/trips/schedule'
import { EntryRows, type Shared } from './Spine'

export type TabId = 'plan' | 'ideas' | 'bookings'

type TabsProps = {
  value: TabId
  onChange: (v: TabId) => void
  ideas: number
  bookings: number
  onMore: (key: 'notes' | 'packing' | 'details') => void
}

/** Plan · Ideas · Bookings as real tabs, with the less-used things behind a ⋯ menu. */
export const TripTabs: React.FC<TabsProps> = ({ value, onChange, ideas, bookings, onMore }) => {
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'plan', label: 'Plan' },
    { id: 'ideas', label: `Ideas (${ideas})` },
    { id: 'bookings', label: `Bookings (${bookings})` },
  ]
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null
    if (n === null) return
    e.preventDefault()
    const next = (n + tabs.length) % tabs.length
    onChange(tabs[next].id)
    refs.current[next]?.focus()
  }
  const items: MenuProps['items'] = [
    { key: 'notes', label: 'Notes' },
    { key: 'packing', label: 'Packing list' },
    { type: 'divider' },
    { key: 'details', label: 'Trip details' },
  ]
  return (
    <div className="trip-tabbar">
      <div className="trip-tabs" role="tablist" aria-label="Trip sections">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={value === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={value === t.id ? 0 : -1}
            className={value === t.id ? 'trip-tab is-on' : 'trip-tab'}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Dropdown
        trigger={['click']}
        placement="bottomRight"
        menu={{ items, onClick: ({ key }) => onMore(key as 'notes' | 'packing' | 'details') }}
      >
        <Button
          type="text"
          shape="circle"
          aria-label="More trip options"
          icon={<DotsThree weight="bold" />}
        />
      </Dropdown>
    </div>
  )
}

type PanelProps = {
  title: string
  onClose: () => void
  // Desktop: a panel docked over the map. Elsewhere: a bottom sheet.
  desktop: boolean
  children: React.ReactNode
}

/** One surface for details, ideas, bookings and notes: docked over the map on desktop, a
 *  focus-trapped bottom sheet on touch screens. Rendered only while open. */
export const Panel: React.FC<PanelProps> = ({ title, onClose, desktop, children }) => {
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
        title={title}
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
      <header className="trip-overlay-head">
        <h2>{title}</h2>
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
      <p className="trip-hint">Park places here, then drag one onto a day or use Move to….</p>
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
      {!ideas.length && <p className="trip-empty-row">No ideas yet</p>}
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
