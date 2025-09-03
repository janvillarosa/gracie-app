import React from 'react'
import { Modal, Space, Button, Input, Typography } from 'antd'
import { ArrowClockwise, X } from '@phosphor-icons/react'

type Props = {
  open: boolean
  token: string | null
  onClose: () => void
  onRotate: () => Promise<void> | void
  title?: string
}

export const ShareCodeModal: React.FC<Props> = ({ open, token, onClose, onRotate, title = 'Share Code' }) => {
  const onCopy = async () => {
    if (!token) return
    try { await navigator.clipboard.writeText(token) } catch {}
  }

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose} icon={<X />}>Close</Button>
          <Button onClick={onRotate} icon={<ArrowClockwise />}>Get new code</Button>
        </Space>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Paragraph type="secondary">
          Share this 5‑character code with your partner to join your house.
        </Typography.Paragraph>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input value={token ?? ''} readOnly aria-label="Share code" />
          <Button onClick={onCopy} disabled={!token}>Copy</Button>
        </div>
      </Space>
    </Modal>
  )
}

export default ShareCodeModal

