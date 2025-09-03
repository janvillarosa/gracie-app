import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Input, Typography } from 'antd'

type Props = {
  value: string
  onSubmit: (newVal: string) => Promise<void> | void
  disabled?: boolean
  placeholder?: string
}

export const InlineEditText: React.FC<Props> = ({ value, onSubmit, disabled, placeholder }) => {
  const [text, setText] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const ref = useRef<any>(null)

  useEffect(() => { setText(value) }, [value])
  useEffect(() => {
    if (ref.current) {
      try { ref.current.focus({ cursor: 'end' }) } catch {}
    }
  }, [])

  const trySubmit = useCallback(async () => {
    if (disabled || submitted) return
    const next = text.trim()
    if (!next) {
      setError('Description can’t be empty')
      // re-focus to keep user in edit mode
      setTimeout(() => { try { ref.current?.focus() } catch {} }, 0)
      return
    }
    setError(null)
    setSubmitted(true)
    await onSubmit(next)
  }, [disabled, text, onSubmit, submitted])

  return (
    <div>
      <Input
        ref={ref}
        value={text}
        onChange={(e) => { setText(e.target.value); if (error) setError(null) }}
        onBlur={trySubmit}
        onPressEnter={trySubmit}
        disabled={disabled}
        placeholder={placeholder}
        aria-label="Edit item"
        status={error ? 'error' : '' as any}
      />
      {error && (
        <Typography.Text type="danger" style={{ fontSize: 12 }}>{error}</Typography.Text>
      )}
    </div>
  )
}

export default InlineEditText
