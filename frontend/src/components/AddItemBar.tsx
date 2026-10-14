import React, { useId, useMemo, useRef, useState } from 'react'
import { Button, Input } from 'antd'
import { Plus } from '@phosphor-icons/react'
import type { PantryItem } from '@api/types'
import { parseInput } from '@lib/parseInput'
import { ghostRemainder, rankSuggestions, type Suggestion } from '@lib/suggest'
import { getCategoryClass } from '@lib/category'

type Parsed = { description: string; quantity?: string; unit?: string }

type Props = {
  // Reject to signal failure; the typed text is restored so the user can retry.
  onCreate: (item: Parsed) => Promise<unknown>
  // The house's past items, best first. Optional: the bar works the same without them.
  pantry?: PantryItem[]
}

const MAX_SLIPS = 5

const Slip = React.memo(function Slip({
  s,
  id,
  active,
  onPick,
}: {
  s: Suggestion
  id: string
  active: boolean
  onPick: (s: Suggestion) => void
}) {
  const { item, start, length } = s
  const usual = [item.quantity, item.unit].filter(Boolean).join(' ')
  return (
    // Options aren't focusable by design: focus stays in the field and the active slip is
    // announced through aria-activedescendant.
    // biome-ignore lint/a11y/useFocusableInteractive: combobox options are not tab stops
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard goes through the combobox field
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-label={usual ? `${item.description}, ${usual}` : item.description}
      className={active ? 'pantry-slip is-active' : 'pantry-slip'}
      // Keep focus in the field so the keyboard stays up for the next add.
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => onPick(s)}
    >
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
    </div>
  )
})

// Owns the draft text so keystrokes re-render only this bar, not the whole list page.
export const AddItemBar: React.FC<Props> = ({ onCreate, pantry }) => {
  const [value, setValue] = useState('')
  // Bumped on every add; re-keys the plus icon so its turn animation replays.
  const [adds, setAdds] = useState(0)
  const ref = useRef<any>(null)
  const uid = useId()
  const listId = `${uid}-slips`
  const [active, setActive] = useState(-1)
  const [dismissed, setDismissed] = useState(false)

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
  const open = slips.length > 0 && !dismissed
  const ghost = open && active < 0 ? ghostRemainder(value, slips[0]) : ''

  const armed = value.trim().length > 0

  const add = (item: Parsed, restore: string) => {
    setValue('')
    setActive(-1)
    setDismissed(false)
    setAdds((n) => n + 1)
    // A short tick where supported (Android); a no-op elsewhere.
    navigator.vibrate?.(8)
    requestAnimationFrame(() => ref.current?.focus())

    onCreate(item).catch(() => {
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

  // Typed quantity wins; otherwise fall back to what the house usually buys.
  const pick = (s: Suggestion) => {
    const typed = parseInput(value.trim())
    add(
      {
        description: s.item.description,
        quantity: typed.quantity || s.item.quantity || undefined,
        unit: typed.quantity ? typed.unit : typed.unit || s.item.unit || undefined,
      },
      value.trim(),
    )
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const composing = e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229
    if (composing) return
    if (open && e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, slips.length - 1))
    } else if (open && e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, -1))
    } else if (open && e.key === 'Escape') {
      e.preventDefault()
      setDismissed(true)
      setActive(-1)
    } else if (e.key === 'Tab' && ghost && !e.shiftKey) {
      e.preventDefault()
      setValue(value.trimEnd() + ghost)
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // Enter only takes a slip the user explicitly moved to; otherwise it adds the typed text.
      if (open && active >= 0) pick(slips[active])
      else submit()
    }
  }

  return (
    <div className="add-bar" role="region" aria-label="Add new item">
      {open && (
        <div id={listId} role="listbox" aria-label="Suggestions" className="pantry-slips">
          {slips.map((s, i) => (
            <Slip
              key={s.item.description}
              s={s}
              id={`${uid}-slip-${i}`}
              active={i === active}
              onPick={pick}
            />
          ))}
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {open ? `${slips.length} suggestion${slips.length === 1 ? '' : 's'}` : ''}
      </span>
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
            className="add-input"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setActive(-1)
              setDismissed(false)
            }}
            placeholder="Add an item"
            autoSize={{ minRows: 1, maxRows: 3 }}
            enterKeyHint="enter"
            onKeyDown={onKeyDown}
            onBlur={() => setActive(-1)}
            aria-label="Add item input"
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-autocomplete="both"
            aria-activedescendant={open && active >= 0 ? `${uid}-slip-${active}` : undefined}
          />
          {qty && (
            <span className="add-qty-chip" aria-hidden>
              {qty}
            </span>
          )}
        </div>
        <Button
          className={armed ? 'add-btn is-armed' : 'add-btn'}
          type="primary"
          shape="circle"
          onClick={submit}
          disabled={!armed}
          icon={<Plus key={adds} className={adds ? 'add-plus is-turning' : 'add-plus'} />}
          size="large"
          aria-label="Add item"
        />
      </div>
    </div>
  )
}
