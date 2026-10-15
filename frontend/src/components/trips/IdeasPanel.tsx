import React, { useCallback, useEffect, useRef, useState } from 'react'
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
/** Remembers, per browser, that the one-time "how to move an idea" tip was shown. */
export const IDEA_TIP_KEY = 'bauhouse_trips_idea_tip'

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
  const [tip, setTip] = useState(false)
  useEffect(() => {
    if (!tip) return
    const t = setTimeout(() => setTip(false), 5000)
    return () => clearTimeout(t)
  }, [tip])
  // The first hover on an idea says how to move it, once (never again, and never if storage is off).
  const onOver = (e: React.MouseEvent) => {
    if (tip || !(e.target as Element).closest?.('.trip-row')) return
    // Only in the desk's Ideas column, where the tip has room.
    if (!(e.currentTarget as Element).closest('.trip-ideas-col')) return
    try {
      if (localStorage.getItem(IDEA_TIP_KEY)) return
      localStorage.setItem(IDEA_TIP_KEY, '1')
    } catch {
      return
    }
    setTip(true)
  }
  const { setNodeRef, isOver } = useDroppable({ id: 'ideas' })
  // A soft fade at the top and bottom edge, only while there is more list in that direction.
  const box = useRef<HTMLElement | null>(null)
  const fade = useCallback(() => {
    const el = box.current
    if (!el) return
    el.style.setProperty('--fade-top', el.scrollTop > 1 ? '16px' : '0px')
    el.style.setProperty(
      '--fade-bottom',
      el.scrollTop + el.clientHeight < el.scrollHeight - 1 ? '16px' : '0px',
    )
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: the list's length is what changes the fade
  useEffect(() => {
    const id = requestAnimationFrame(fade)
    return () => cancelAnimationFrame(id)
  }, [ideas.length, fade])
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
    <>
      {tip && (
        <div className="trip-ideas-tip" role="status">
          Drag onto a day, or press Enter to pick one
        </div>
      )}
      <section
        ref={(el) => {
          setNodeRef(el)
          box.current = el
        }}
        onScroll={fade}
        className={isOver ? 'trip-ideas is-over' : 'trip-ideas'}
        aria-label="Ideas"
        onMouseOver={onOver}
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
    </>
  )
}
