import React, { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { TripTodo } from '@api/tripTypes'
import type { Entry } from '@lib/trips/schedule'
import { Field } from '@components/ui'
import { EntryRows, type Shared } from './Spine'

type IdeasProps = {
  ideas: TripTodo[]
  shared: Shared
  moveOpenId: string | null
  selectedId: string | null
  enteringId: string | null
  // The line under the title when this is the Ideas tab (the docked sheet says it in its identity).
  hint?: boolean
}

const MANY = 30

/** Ideas: places you might go, as rows without checkboxes. A drop target for todos. */
export const IdeasPanel: React.FC<IdeasProps> = ({
  ideas,
  shared,
  moveOpenId,
  selectedId,
  enteringId,
  hint = true,
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
      {hint && (
        <p className="trip-hint">Places you might go. Move one onto a day when you’re ready.</p>
      )}
      {many && (
        <Field
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
          ideas
        />
      )}
      {!ideas.length && <p className="trip-empty-row">Nothing here yet</p>}
    </section>
  )
}
