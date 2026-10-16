import React, { useMemo, useRef, useState } from 'react'
import { Button, Input } from 'antd'
import { Plus } from '@phosphor-icons/react'
import type { PantryItem } from '@api/types'
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
}

const MAX_SLIPS = 5

const slipUsual = (item: PantryItem) => [item.quantity, item.unit].filter(Boolean).join(' ')
const slipKey = (s: Suggestion) => s.item.description
const slipLabel = (s: Suggestion) => {
  const usual = slipUsual(s.item)
  return usual ? `${s.item.description}, ${usual}` : s.item.description
}

// The inside of one slip; the Combobox owns the option element (role, id, click) around it.
const SlipBody = React.memo(function SlipBody({ s }: { s: Suggestion }) {
  const { item, start, length } = s
  const usual = slipUsual(item)
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
const renderSlip = (s: Suggestion) => <SlipBody s={s} />

// Owns the draft text so keystrokes re-render only this bar, not the whole list page.
export const AddItemBar: React.FC<Props> = ({ onCreate, pantry, listId }) => {
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
  // The Combobox draws it only while the top slip is the target (nothing arrowed to).
  const ghostTail = slips.length ? ghostRemainder(value, slips[0]) : ''

  const armed = value.trim().length > 0

  const add = (item: Parsed, restore: string) => {
    setValue('')
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
    if (listId) {
      track('add_bar.suggestion_accepted', {
        subject: { type: 'add_bar', id: listId },
        container: { type: 'list', id: listId },
        key: s.item.description,
        props: { rank: slips.indexOf(s) + 1 },
      })
    }
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
        )}
      </Combobox>
    </div>
  )
}
