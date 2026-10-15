import React, { useState } from 'react'
import { Button, Input, Modal } from 'antd'

type Props = {
  title: string
  cta: string
  initial?: string
  onSubmit: (name: string) => void
  onCancel: () => void
}

// Asks one thing: the name. Dates, a destination and the route come later, from the trip's
// settings or from the nudge in an empty plan.
export const TripNameModal: React.FC<Props> = ({
  title,
  cta,
  initial = '',
  onSubmit,
  onCancel,
}) => {
  const [name, setName] = useState(initial)
  const submit = () => {
    if (name.trim()) onSubmit(name.trim())
  }
  return (
    <Modal
      open
      title={title}
      onCancel={onCancel}
      destroyOnClose
      footer={
        <Button type="primary" shape="round" disabled={!name.trim()} onClick={submit}>
          {cta}
        </Button>
      }
    >
      <Input
        aria-label="Trip name"
        placeholder="Autumn in Lisbon"
        value={name}
        maxLength={120}
        // biome-ignore lint/a11y/noAutofocus: the sheet opens because the user asked for it
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onPressEnter={submit}
      />
    </Modal>
  )
}
