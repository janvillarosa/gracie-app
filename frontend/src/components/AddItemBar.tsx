import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Button } from '@components/ui'
import { Input } from 'antd'
import { Plus } from '@phosphor-icons/react'
import type { ListItem, PantryItem } from '@api/types'
import { compactKey } from '@lib/itemKey'
import { parseInput } from '@lib/parseInput'
import { ghostRemainder, rankSuggestions, type Suggestion } from '@lib/suggest'
import { getCategoryClass } from '@lib/category'
import { Combobox } from '@components/ui/Combobox'
import { track } from '@lib/analytics'

type Parsed = { description: string; quantity?: string; unit?: string }

type Props = {
  // Reject to signal failure; the typed text is restored so the user can retry.
  onCreate: (item: Parsed) => Promise<unknown>
  // The house's past items, best first. Optional: the bar works the same without them.
  pantry?: PantryItem[]
  // Which list the bar adds to; lets us learn how often a suggestion is taken over typing.
  listId?: string
  // The list's items. A slip for one of them says "on list", and picking it calls onBump
  // (more of it, or back from checked off) instead of adding a second row.
  onList?: ListItem[]
  // Reject to signal failure, as with onCreate.
  onBump?: (item: ListItem, typed: Parsed) => Promise<unknown>
  // The field's DOM id, for the desk's "/" shortcut to find it.
  inputId?: string
}

// Three keep the slips inside the room above the bar on a short phone with the keyboard up.
const MAX_SLIPS = 3

const slipUsual = (item: PantryItem) => [item.quantity, item.unit].filter(Boolean).join(' ')
const slipKey = (s: Suggestion) => s.item.description
// What the slip says beside the name: "on list" for an item already there, else the usual amount.
const slipAside = (item: PantryItem, listed?: ListItem) => {
  if (!listed) return slipUsual(item)
  const has = [listed.quantity, listed.unit].filter(Boolean).join(' ')
  if (listed.completed) return 'checked off'
  return has ? `on list, ${has}` : 'on list'
}

// The inside of one slip; the Combobox owns the option element (role, id, click) around it.
const SlipBody = React.memo(function SlipBody({ s, listed }: { s: Suggestion; listed?: ListItem }) {
  const { item, start, length } = s
  const usual = slipAside(item, listed)
  return (
    <>
      <span className="slip-name">
        {item.description.slice(0, start)}
        <mark className="slip-hit">{item.description.slice(start, start + length)}</mark>
        {item.description.slice(start + length)}
      </span>
      {usual && <span className="slip-usual">{usual}</span>}
      {item.category && (
        <span className={`category-tag slip-cat ${getCategoryClass(item.category)}`}>
          {item.category}
        </span>
      )}
    </>
  )
})

// Owns the draft text so keystrokes re-render only this bar, not the whole list page.
export const AddItemBar: React.FC<Props> = ({
  onCreate,
  pantry,
  listId,
  onList,
  onBump,
  inputId,
}) => {
  const [value, setValue] = useState('')
  // Bumped on every add; re-keys the plus icon so its turn animation replays.
  const [adds, setAdds] = useState(0)
  const ref = useRef<any>(null)

  const parsed = useMemo(() => {
    const text = value.trim()
    return text ? parseInput(text) : null
  }, [value])

  // Live preview of the quantity the parser will pull out ("2 kg flour" -> "2 kg").
  const qty = parsed?.description ? [parsed.quantity, parsed.unit].filter(Boolean).join(' ') : ''

  const slips = useMemo(
    () => (pantry?.length ? rankSuggestions(value, pantry, MAX_SLIPS) : []),
    [value, pantry],
  )
  // Items on the list by folded name; an unchecked row wins over a checked-off one.
  const listed = useMemo(() => {
    const m = new Map<string, ListItem>()
    if (!onBump) return m
    for (const it of onList ?? []) {
      const k = compactKey(it.description)
      const had = m.get(k)
      if (!had || (had.completed && !it.completed)) m.set(k, it)
    }
    return m
  }, [onList, onBump])
  const listedFor = useCallback(
    (s: Suggestion) => listed.get(compactKey(s.item.description)),
    [listed],
  )
  const slipLabel = useCallback(
    (s: Suggestion) => {
      const aside = slipAside(s.item, listedFor(s))
      return aside ? `${s.item.description}, ${aside}` : s.item.description
    },
    [listedFor],
  )
  const renderSlip = useCallback(
    (s: Suggestion) => <SlipBody s={s} listed={listedFor(s)} />,
    [listedFor],
  )

  // The Combobox draws it only while the top slip is the target (nothing arrowed to).
  const ghostTail = slips.length ? ghostRemainder(value, slips[0]) : ''

  const armed = value.trim().length > 0

  const add = (item: Parsed, restore: string) => run(() => onCreate(item), restore)

  // Clears the bar at once and puts the text back if the write fails.
  const run = (write: () => Promise<unknown>, restore: string) => {
    setValue('')
    setAdds((n) => n + 1)
    // A short tick where supported (Android); a no-op elsewhere.
    navigator.vibrate?.(8)
    requestAnimationFrame(() => ref.current?.focus())

    write().catch(() => {
      setValue(restore)
      ref.current?.focus()
    })
  }

  const submit = () => {
    const text = value.trim()
    if (!text) return
    const { description, quantity, unit } = parseInput(text)
    if (!description) return
    add({ description, quantity, unit }, text)
  }

  // Typed quantity wins; otherwise fall back to what the house usually buys. An item already
  // on the list is bumped instead.
  const pick = (s: Suggestion) => {
    const onListItem = listedFor(s)
    if (listId) {
      track('add_bar.suggestion_accepted', {
        subject: { type: 'add_bar', id: listId },
        container: { type: 'list', id: listId },
        key: s.item.description,
        props: { rank: slips.indexOf(s) + 1, ...(onListItem ? { on_list: true } : {}) },
      })
    }
    const typed = parseInput(value.trim())
    if (onListItem && onBump) {
      run(() => onBump(onListItem, typed), value.trim())
      return
    }
    add(
      {
        description: s.item.description,
        quantity: typed.quantity || s.item.quantity || undefined,
        unit: typed.quantity ? typed.unit : typed.unit || s.item.unit || undefined,
      },
      value.trim(),
    )
  }

  return (
    <div className="add-bar" role="region" aria-label="Add new item">
      <Combobox
        options={slips}
        getKey={slipKey}
        getLabel={slipLabel}
        renderOption={renderSlip}
        onPick={pick}
        onSubmitText={submit}
        query={value}
        ghost={ghostTail}
        onAcceptGhost={() => setValue(value.trimEnd() + ghostTail)}
        autoComplete="both"
      >
        {({ input, ghost }) => (
          <div className="add-row">
            <div className={qty ? 'add-field has-qty' : 'add-field'}>
              {ghost && (
                <div className="add-ghost" aria-hidden>
                  <span className="add-ghost-typed">{value.trimEnd()}</span>
                  {ghost}
                </div>
              )}
              <Input.TextArea
                ref={ref}
                id={inputId}
                className="add-input"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Add an item"
                autoSize={{ minRows: 1, maxRows: 3 }}
                enterKeyHint="enter"
                aria-label="Add item input"
                {...input}
              />
              {qty && (
                <span className="add-qty-chip" aria-hidden>
                  {qty}
                </span>
              )}
            </div>
            <Button
              kind="key"
              iconOnly
              className={armed ? 'add-btn is-armed' : 'add-btn'}
              onClick={submit}
              disabled={!armed}
              icon={
                <Plus
                  key={adds}
                  weight="bold"
                  className={adds ? 'add-plus is-turning' : 'add-plus'}
                />
              }
              aria-label="Add item"
            />
          </div>
        )}
      </Combobox>
    </div>
  )
}
