import React, { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@auth/AuthProvider'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getMe, updateMyProfile, changeMyPassword, deleteMyAccount } from '@api/endpoints'
import type { User } from '@api/types'
import { Card, Typography, Space, Button, Input, Form, Modal, Grid, Divider, message } from 'antd'
import { Avatar } from '@components/Avatar'
import { ArrowLeft, FloppyDisk, Trash } from '@phosphor-icons/react'
import { useDocumentTitle } from '@lib/useDocumentTitle'

function isEmail(v: string) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)
}

export const UserSettings: React.FC = () => {
  const { apiKey, setApiKey } = useAuth()
  const navigate = useNavigate()
  useDocumentTitle('Account Settings')
  const qc = useQueryClient()
  const meQuery = useQuery<User>({ queryKey: ['me'], queryFn: () => getMe(apiKey!) })
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [initialized, setInitialized] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [pwdSaving, setPwdSaving] = useState(false)
  const [curPwd, setCurPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [newPwd2, setNewPwd2] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md

  useEffect(() => {
    if (!initialized && meQuery.data) {
      setName(meQuery.data.name || '')
      setEmail(meQuery.data.username || '')
      setInitialized(true)
    }
  }, [meQuery.data, initialized])

  const profileChanged = useMemo(() => {
    return name !== (meQuery.data?.name || '') || email !== (meQuery.data?.username || '')
  }, [name, email, meQuery.data])

  const canSaveProfile = useMemo(() => {
    if (!profileChanged) return false
    if (email && !isEmail(email)) return false
    return true
  }, [profileChanged, email])

  async function onSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (email && !isEmail(email)) { message.error('Invalid email'); return }
    setProfileSaving(true)
    try {
      const body: any = {}
      if (name !== meQuery.data?.name) body.name = name
      if (email !== meQuery.data?.username) body.username = email
      await updateMyProfile(apiKey!, body)
      message.success('Profile updated')
      await qc.invalidateQueries({ queryKey: ['me'] })
    } catch (e: any) {
      message.error(e?.message || 'Failed to update profile')
    } finally {
      setProfileSaving(false)
    }
  }

  const needsCurrent = !!meQuery.data?.username
  const canSavePwd = newPwd.length >= 8 && newPwd === newPwd2 && (!needsCurrent || !!curPwd)

  async function onSavePassword(e: React.FormEvent) {
    e.preventDefault()
    if (!canSavePwd) return
    setPwdSaving(true)
    try {
      const res = await changeMyPassword(apiKey!, { current_password: curPwd || undefined, new_password: newPwd })
      setApiKey(res.api_key)
      setCurPwd('')
      setNewPwd('')
      setNewPwd2('')
      message.success('Password updated')
    } catch (e: any) {
      message.error(e?.message || 'Failed to update password')
    } finally {
      setPwdSaving(false)
    }
  }

  async function onConfirmDelete() {
    try {
      await deleteMyAccount(apiKey!)
      setApiKey(null)
      navigate('/login', { replace: true })
    } catch (e: any) {
      message.error(e?.message || 'Failed to delete account')
    } finally {
      setConfirmOpen(false)
    }
  }

  return (
    <div className="container">
      <Card>
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {isMobile ? (
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              <Typography.Title level={2} style={{ margin: 0 }}>Account Settings</Typography.Title>
              <Space wrap>
                <Button onClick={() => navigate('/app')} icon={<ArrowLeft />}>Back</Button>
              </Space>
            </Space>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography.Title level={2} style={{ margin: 0 }}>Account Settings</Typography.Title>
              <Button onClick={() => navigate('/app')} icon={<ArrowLeft />}>Back</Button>
            </div>
          )}

          <Form layout="vertical" onSubmitCapture={onSaveProfile}>
            <Typography.Title level={4} style={{ marginTop: 0 }}>Profile</Typography.Title>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: isMobile ? 'wrap' as const : 'nowrap' as const }}>
              <div style={{ flex: 1, minWidth: 280 }}>
                <Form.Item label="Display name">
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </Form.Item>
                <Form.Item label="Email">
                  <Input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" />
                </Form.Item>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                {meQuery.data?.avatar_key && (
                  <Avatar seed={meQuery.data.avatar_key} size={96} style={'miniavs'} alt={`${name || email || 'User'} avatar`} />
                )}
                <Typography.Text type="secondary" style={{ textAlign: 'center', maxWidth: 220 }}>
                  This avatar is auto‑generated. Changing it isn’t supported yet.
                </Typography.Text>
              </div>
            </div>
            <div style={{ paddingTop: 8 }}>
              <Button type="primary" htmlType="submit" disabled={!canSaveProfile || profileSaving} icon={<FloppyDisk />}>Save Profile</Button>
            </div>
          </Form>

          <Divider className="settings-divider" />

          <Form layout="vertical" onSubmitCapture={onSavePassword}>
            <Typography.Title level={4} style={{ marginTop: 0 }}>Password</Typography.Title>
            {needsCurrent && (
              <Form.Item label="Current password">
                <Input.Password value={curPwd} onChange={(e) => setCurPwd(e.target.value)} autoComplete="current-password" />
              </Form.Item>
            )}
            <Form.Item label="New password (mininum of 8 characters)">
              <Input.Password value={newPwd} onChange={(e) => setNewPwd(e.target.value)} autoComplete="new-password" />
            </Form.Item>
            <Form.Item label="Confirm new password">
              <Input.Password value={newPwd2} onChange={(e) => setNewPwd2(e.target.value)} autoComplete="new-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" disabled={!canSavePwd || pwdSaving} icon={<FloppyDisk />}>Save Password</Button>
          </Form>

          <Divider className="settings-divider" />

          <div>
            <Typography.Title level={4} style={{ marginTop: 0 }}>Danger Zone</Typography.Title>
            <Button danger icon={<Trash />} onClick={() => setConfirmOpen(true)}>Permanently delete my account</Button>
          </div>

        </Space>
      </Card>

      <Modal
        title="Delete your account?"
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        footer={null}
      >
        <DeleteConfirm onConfirm={onConfirmDelete} onCancel={() => setConfirmOpen(false)} />
      </Modal>
    </div>
  )
}

const DeleteConfirm: React.FC<{ onConfirm: () => void; onCancel: () => void }> = ({ onConfirm, onCancel }) => {
  const [text, setText] = useState('')
  const can = text === 'DELETE'
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Typography.Paragraph>
        This action will permanently remove your account. You will be removed from your House. If your House only has you as a member, it will be deleted along with its lists and items. This cannot be undone.
      </Typography.Paragraph>
      <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type DELETE to confirm" />
      <Space>
        <Button onClick={onCancel}>Cancel</Button>
        <Button danger type="primary" disabled={!can} onClick={onConfirm}>Yes, delete my account</Button>
      </Space>
    </Space>
  )
}

export default UserSettings
