import React, { useMemo, useRef, useState } from 'react'
import { Button, Input } from 'antd'
import { Plus } from '@phosphor-icons/react'
import { parseInput } from '@lib/parseInput'

type Parsed = { description: string; quantity?: string; unit?: string }

type Props = {
  // Reject to signal failure; the typed text is restored so the user can retry.
  onCreate: (item: Parsed) => Promise<unknown>
}

// Owns the draft text so keystrokes re-render only this bar, not the whole list page.
export const AddItemBar: React.FC<Props> = ({ onCreate }) => {
  const [value, setValue] = useState('')
  // Bumped on every add; re-keys the plus icon so its turn animation replays.
  const [adds, setAdds] = useState(0)
  const ref = useRef<any>(null)

  // Live preview of the quantity the parser will pull out ("2 kg flour" -> "2 kg").
  const qty = useMemo(() => {
    const text = value.trim()
    if (!text) return ''
    const { description, quantity, unit } = parseInput(text)
    if (!description) return ''
    return [quantity, unit].filter(Boolean).join(' ')
  }, [value])

  const armed = value.trim().length > 0

  const submit = () => {
    const text = value.trim()
    if (!text) return
    const { description, quantity, unit } = parseInput(text)
    if (!description) return

    setValue('')
    setAdds((n) => n + 1)
    // A short tick where supported (Android); a no-op elsewhere.
    navigator.vibrate?.(8)
    requestAnimationFrame(() => ref.current?.focus())

    onCreate({ description, quantity, unit }).catch(() => {
      setValue(text)
      ref.current?.focus()
    })
  }

  return (
    <div className="add-bar" role="region" aria-label="Add new item">
      <div className="add-row">
        <div className={qty ? 'add-field has-qty' : 'add-field'}>
          <Input.TextArea
            ref={ref}
            className="add-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Add an item"
            autoSize={{ minRows: 1, maxRows: 3 }}
            enterKeyHint="enter"
            onKeyDown={(e) => {
              const composing = e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229
              if (e.key === 'Enter' && !e.shiftKey && !composing) {
                e.preventDefault()
                submit()
              }
            }}
            aria-label="Add item input"
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
