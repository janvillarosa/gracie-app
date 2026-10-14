import React, { useEffect, useState } from 'react'
import { Modal, Space, Button, Input, Typography } from 'antd'
import { ArrowClockwise, X } from '@phosphor-icons/react'

type Props = {
  open: boolean
  token: string | null
  onClose: () => void
  onRotate: () => Promise<void> | void
  title?: string
}

export const ShareCodeModal: React.FC<Props> = ({
  open,
  token,
  onClose,
  onRotate,
  title = 'Share code',
}) => {
  // 'idle' | 'copied' | 'failed': the button says what happened instead of staying silent.
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (copyState === 'idle') return
    const t = setTimeout(() => setCopyState('idle'), 2000)
    return () => clearTimeout(t)
  }, [copyState])

  const onCopy = async () => {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose} icon={<X />}>
            Close
          </Button>
          <Button onClick={onRotate} icon={<ArrowClockwise />}>
            Get new code
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Paragraph type="secondary">
          Give this 5-character code to anyone you want in your house. They enter it under Join an
          existing house.
        </Typography.Paragraph>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input value={token ?? ''} readOnly aria-label="Share code" />
          <Button onClick={onCopy} disabled={!token} aria-live="polite">
            {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
          </Button>
        </div>
      </Space>
    </Modal>
  )
}

export default ShareCodeModal
