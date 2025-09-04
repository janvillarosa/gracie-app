import React, { useEffect, useMemo, useState } from 'react'
import { Modal, Form, Input, Space, Button, Typography } from 'antd'
import { isValidDisplayName, MAX_DESCRIPTION } from '@lib/validation'

type Props = {
  open: boolean
  onClose: () => void
  onSubmit: (values: { display_name?: string; description?: string }) => Promise<void> | void
  submitting?: boolean
}

export const CreateHouseModal: React.FC<Props> = ({ open, onClose, onSubmit, submitting }) => {
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const nameError = useMemo(() => {
    if (!displayName) return undefined // optional
    return isValidDisplayName(displayName) ? undefined : 'Up to 64 chars; alphanumeric + spaces'
  }, [displayName])
  const descError = useMemo(() => {
    return description.length <= MAX_DESCRIPTION ? undefined : 'Description too long'
  }, [description])

  useEffect(() => {
    if (!open) {
      setDisplayName('')
      setDescription('')
    }
  }, [open])

  const canSubmit = !submitting && !nameError && !descError

  return (
    <Modal
      title="Create a solo house"
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" disabled={!canSubmit} onClick={() => onSubmit({ display_name: displayName || undefined, description: description || undefined })}>
            Create
          </Button>
        </Space>
      }
    >
      <Form layout="vertical">
        <Form.Item
          label="House name"
          validateStatus={nameError ? 'error' : ''}
          help={nameError}
        >
          <Input
            placeholder="e.g., Our Little Mansion"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoFocus
            onPressEnter={(e) => { e.preventDefault(); if (canSubmit) onSubmit({ display_name: displayName || undefined, description: description || undefined }) }}
          />
        </Form.Item>
        <Form.Item
          label="Description (optional)"
          validateStatus={descError ? 'error' : ''}
          help={descError}
        >
          <Input.TextArea
            rows={3}
            placeholder="Add a short description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Form.Item>
        <Typography.Text type="secondary">You can change these later in House Settings.</Typography.Text>
      </Form>
    </Modal>
  )
}

export default CreateHouseModal

