import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@auth/AuthProvider'
import { rotateShare, voteDeletion, cancelDeletion, updateRoomSettings, getMyRoom } from '@api/endpoints'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, Typography, Space, Button, Input, Form, Grid, message } from 'antd'
import { ArrowLeft, FloppyDisk, ShareNetwork, Trash, XCircle } from '@phosphor-icons/react'
import { isValidDisplayName, MAX_DESCRIPTION } from '@lib/validation'
import { ShareCodeModal } from '@components/ShareCodeModal'

const NAME_RE = /^[A-Za-z0-9 ]+$/ // kept for backwards compatibility if referenced; prefer lib/validation

export const RoomSettings: React.FC = () => {
  const { apiKey } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const roomQuery = useQuery({ queryKey: ['my-room'], queryFn: () => getMyRoom(apiKey!) })
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [initialized, setInitialized] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareToken, setShareToken] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md

  const nameValid = useMemo(() => !displayName || isValidDisplayName(displayName), [displayName])

  // Initialize form fields with current values once room data is loaded
  useEffect(() => {
    if (!initialized && roomQuery.data) {
      setDisplayName(roomQuery.data.display_name || '')
      setDescription(roomQuery.data.description || '')
      setInitialized(true)
    }
  }, [roomQuery.data, initialized])

  const originalName = roomQuery.data?.display_name || ''
  const originalDesc = roomQuery.data?.description || ''
  const hasChanges = displayName !== originalName || description !== originalDesc

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (displayName && !nameValid) {
      message.error('Name is up to 64 characters. Only letters, numbers and spaces')
      return
    }
    if (description.length > MAX_DESCRIPTION) {
      message.error('Description too long')
      return
    }
    setSaving(true)
    try {
      const payload: { display_name?: string; description?: string } = {}
      if (displayName !== originalName) payload.display_name = displayName || undefined
      if (description !== originalDesc) payload.description = description
      await updateRoomSettings(apiKey!, payload)
      message.success('Saved')
      qc.invalidateQueries({ queryKey: ['my-room'] })
    } catch (e: any) {
      message.error(e?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const onShare = async () => {
    try {
      const r = await rotateShare(apiKey!)
      setShareToken(r.token)
      setShareOpen(true)
    } catch (e: any) {
      message.error(e?.message || 'Failed to rotate share code')
    }
  }

  const onVoteDelete = async () => {
    try {
      const res = await voteDeletion(apiKey!)
      if (res.deleted) {
        // Room deleted; go back to dashboard
        navigate('/app', { replace: true })
      } else {
        message.success('Deletion vote recorded')
      }
      qc.invalidateQueries({ queryKey: ['my-room'] })
    } catch (e: any) {
      message.error(e?.message || 'Failed to vote deletion')
    }
  }

  const onCancelVote = async () => {
    try {
      await cancelDeletion(apiKey!)
      message.success('Deletion vote canceled')
      qc.invalidateQueries({ queryKey: ['my-room'] })
    } catch (e: any) {
      message.error(e?.message || 'Failed to cancel vote')
    }
  }

  return (
    <div className="container">
      <Card>
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {isMobile ? (
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              <Typography.Title level={2} style={{ margin: 0 }}>House Settings</Typography.Title>
              <Space wrap>
                <Button onClick={() => navigate('/app')} icon={<ArrowLeft />}>Back</Button>
              </Space>
            </Space>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography.Title level={2} style={{ margin: 0 }}>House Settings</Typography.Title>
              <Button onClick={() => navigate('/app')} icon={<ArrowLeft />}>Back</Button>
            </div>
          )}
          <Form layout="vertical" onSubmitCapture={onSave}>
            <Form.Item
              label="Display name (alphanumeric + spaces)"
              validateStatus={displayName && !nameValid ? 'error' : ''}
              help={displayName && !nameValid ? 'Up to 64 chars; alphanumeric + spaces' : undefined}
            >
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </Form.Item>
            <Form.Item label="Description">
              <Input.TextArea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Form.Item>
            <Button type="primary" htmlType="submit" disabled={saving || !hasChanges || !nameValid} icon={<FloppyDisk />}>Save</Button>
          </Form>
          <Space wrap>
            <Button type="primary" onClick={onShare} icon={<ShareNetwork />}>Get share code</Button>
            {roomQuery.data?.my_deletion_vote ? (
              <Button onClick={onCancelVote} icon={<XCircle />}>Cancel vote</Button>
            ) : (
              <Button danger onClick={onVoteDelete} icon={<Trash />}>Vote to delete house</Button>
            )}
          </Space>
          <ShareCodeModal
            open={shareOpen}
            token={shareToken}
            onClose={() => setShareOpen(false)}
            onRotate={onShare}
            title="Share House"
          />
        </Space>
      </Card>
    </div>
  )
}
