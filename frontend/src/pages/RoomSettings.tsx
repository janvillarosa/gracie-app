import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@auth/AuthProvider'
import { rotateShare, voteDeletion, cancelDeletion, updateRoomSettings, getMyRoom } from '@api/endpoints'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, Typography, Space, Button, Input, Modal, Alert, Form, Grid } from 'antd'
import { ArrowLeftOutlined, SaveOutlined, ShareAltOutlined, DeleteOutlined, CloseCircleOutlined, ReloadOutlined, CheckOutlined } from '@ant-design/icons'

const NAME_RE = /^[A-Za-z0-9 ]+$/

export const RoomSettings: React.FC = () => {
  const { apiKey } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const roomQuery = useQuery({ queryKey: ['my-room'], queryFn: () => getMyRoom(apiKey!) })
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareToken, setShareToken] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md

  const nameValid = useMemo(() => !displayName || (displayName.length <= 64 && NAME_RE.test(displayName)), [displayName])

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    if (displayName && !nameValid) {
      setError('Display name must be alphanumeric with spaces, up to 64 chars')
      return
    }
    if (description.length > 512) {
      setError('Description too long')
      return
    }
    setSaving(true)
    try {
      await updateRoomSettings(apiKey!, { display_name: displayName || undefined, description })
      setSuccess('Saved')
      qc.invalidateQueries({ queryKey: ['my-room'] })
    } catch (e: any) {
      setError(e?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const onShare = async () => {
    setError(null)
    setSuccess(null)
    try {
      const r = await rotateShare(apiKey!)
      setShareToken(r.token)
      setShareOpen(true)
    } catch (e: any) {
      setError(e?.message || 'Failed to rotate share code')
    }
  }

  const onVoteDelete = async () => {
    setError(null)
    setSuccess(null)
    try {
      const res = await voteDeletion(apiKey!)
      if (res.deleted) {
        // Room deleted; go back to dashboard
        navigate('/app', { replace: true })
      } else {
        setSuccess('Deletion vote recorded')
      }
      qc.invalidateQueries({ queryKey: ['my-room'] })
    } catch (e: any) {
      setError(e?.message || 'Failed to vote deletion')
    }
  }

  const onCancelVote = async () => {
    setError(null)
    setSuccess(null)
    try {
      await cancelDeletion(apiKey!)
      setSuccess('Deletion vote canceled')
      qc.invalidateQueries({ queryKey: ['my-room'] })
    } catch (e: any) {
      setError(e?.message || 'Failed to cancel vote')
    }
  }

  return (
    <div className="container">
      <Card>
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {isMobile ? (
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              <Typography.Title level={3} style={{ margin: 0 }}>House Settings</Typography.Title>
              <Space wrap>
                <Button onClick={() => navigate('/app')} icon={<ArrowLeftOutlined />}>Back</Button>
              </Space>
            </Space>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography.Title level={3} style={{ margin: 0 }}>House Settings</Typography.Title>
              <Button onClick={() => navigate('/app')} icon={<ArrowLeftOutlined />}>Back</Button>
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
            <Button type="primary" htmlType="submit" disabled={saving || (!displayName && !description) || !nameValid} icon={<SaveOutlined />}>Save</Button>
          </Form>
          <Space wrap>
            <Button type="primary" onClick={onShare} icon={<ShareAltOutlined />}>Get share code</Button>
            {roomQuery.data?.my_deletion_vote ? (
              <Button onClick={onCancelVote} icon={<CloseCircleOutlined />}>Cancel vote</Button>
            ) : (
              <Button danger onClick={onVoteDelete} icon={<DeleteOutlined />}>Vote to delete house</Button>
            )}
          </Space>
          <Modal
            title="Share House"
            open={shareOpen}
            onCancel={() => setShareOpen(false)}
            footer={
              <Space>
                <Button type="primary" onClick={onShare} icon={<ReloadOutlined />}>Get new code</Button>
                <Button onClick={() => setShareOpen(false)} icon={<CheckOutlined />}>Done</Button>
              </Space>
            }
          >
            <div>
              {shareToken ? (
                <>
                  <div>
                    Code: <code>{shareToken}</code> (5 chars, no I/O/L)
                  </div>
                  <Typography.Text type="secondary">Share this code with your partner.</Typography.Text>
                </>
              ) : (
                <div>Generating code…</div>
              )}
            </div>
          </Modal>
          {error && <Alert type="error" message={error} showIcon />}
          {success && <Alert type="success" message={success} showIcon />}        
        </Space>
      </Card>
    </div>
  )
}
