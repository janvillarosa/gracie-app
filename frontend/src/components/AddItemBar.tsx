import React, { useRef, useState } from 'react'
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
  const ref = useRef<any>(null)

  const submit = () => {
    const text = value.trim()
    if (!text) return
    const { description, quantity, unit } = parseInput(text)
    if (!description) return

    setValue('')
    requestAnimationFrame(() => ref.current?.focus())

    onCreate({ description, quantity, unit }).catch(() => {
      setValue(text)
      ref.current?.focus()
    })
  }

  return (
    <div className="add-bar" role="region" aria-label="Add new item">
      <div className="add-row">
        <Input.TextArea
          ref={ref}
          className="add-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Add an item"
          autoSize={{ minRows: 1, maxRows: 3 }}
          onKeyDown={(e) => {
            const composing = e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229
            if (e.key === 'Enter' && !e.shiftKey && !composing) {
              e.preventDefault()
              submit()
            }
          }}
          aria-label="Add item input"
        />
        <Button
          className="add-btn"
          type="primary"
          shape="circle"
          onClick={submit}
          disabled={!value.trim()}
          icon={<Plus />}
          size="large"
          aria-label="Add item"
        />
      </div>
    </div>
  )
}
