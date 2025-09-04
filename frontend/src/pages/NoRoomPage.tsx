import React, { useMemo, useState } from 'react'
import { useAuth } from '@auth/AuthProvider'
import { createRoom, updateRoomSettings, isConflict, isForbidden, joinRoomByToken } from '@api/endpoints'
import { Card, Typography, Form, Input, Button, Space, Grid, Divider, message } from 'antd'
import { SignOut, Plus, UsersThree } from '@phosphor-icons/react'
import { CreateHouseModal } from '@components/CreateHouseModal'
import { useNavigate } from 'react-router-dom'
import { useDocumentTitle } from '@lib/useDocumentTitle'

const TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ0123456789' // no I, O, L

export const NoRoomPage: React.FC = () => {
  const { apiKey, setApiKey } = useAuth()
  const navigate = useNavigate()
  useDocumentTitle('Join or Create a House')
  const [token, setToken] = useState('')
  
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  const tokenValid = useMemo(() => token.length === 5 && [...token].every((c) => TOKEN_ALPHABET.includes(c)), [token])

  const onCreateWithDetails = async (vals: { display_name?: string; description?: string }) => {
    setCreating(true)
    try {
      await createRoom(apiKey!)
      if (vals.display_name || typeof vals.description === 'string') {
        await updateRoomSettings(apiKey!, { display_name: vals.display_name, description: vals.description ?? '' })
      }
      setCreateOpen(false)
      navigate('/app', { replace: true })
    } catch (e: any) {
      message.error(e?.message || 'Failed to create house')
    } finally {
      setCreating(false)
    }
  }

  const onJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await joinRoomByToken(apiKey!, token.trim().toUpperCase())
      window.location.reload()
    } catch (e: any) {
      if (isForbidden(e)) message.error('Invalid code for this house.')
      else if (isConflict(e)) message.error('Join not allowed: the house may be full.')
      else message.error(e?.message || 'Failed to join house')
    } finally {
      setLoading(false)
    }
  }

  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md

  return (
    <div className="container">
      <Card className="no-room-card">
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {isMobile ? (
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              <Typography.Title level={2} style={{ margin: 0 }}>You are not in a house yet</Typography.Title>
              <Space wrap>
                <Button onClick={() => setApiKey(null)} icon={<SignOut />}>Logout</Button>
              </Space>
            </Space>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography.Title level={2} style={{ margin: 0 }}>You are not in a house yet</Typography.Title>
              <Button onClick={() => setApiKey(null)} icon={<SignOut />}>Logout</Button>
            </div>
          )}
          <div className="section">
            <Typography.Title level={3} style={{ marginTop: 0 }}>Create a new house</Typography.Title>
            <Typography.Text className="no-room-subtitle">You will be the only member until someone joins.</Typography.Text>
            <Button type="primary" onClick={() => setCreateOpen(true)} disabled={loading} icon={<Plus />} block>
              New House
            </Button>
          </div>

          <Divider className="no-room-divider" />

          <div className="section">
            <Typography.Title level={3} style={{ marginTop: 0 }}>Join an existing house</Typography.Title>
            <Form layout="vertical" onSubmitCapture={onJoin}>
              <Form.Item label="5-character code">
                <div className="join-row">
                  <Input
                    placeholder="5-character code"
                    value={token}
                    onChange={(e) => setToken(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                    maxLength={5}
                  />
                  {!isMobile && (
                    <Button type="primary" htmlType="submit" disabled={!tokenValid || loading} icon={<UsersThree />}>Join house</Button>
                  )}
                </div>
              </Form.Item>
              {isMobile && (
                <Button type="primary" htmlType="submit" disabled={!tokenValid || loading} icon={<UsersThree />} block>
                  Join house
                </Button>
              )}
            </Form>
          </div>
          
        </Space>
        <CreateHouseModal open={createOpen} onClose={() => setCreateOpen(false)} onSubmit={onCreateWithDetails} submitting={creating} />
      </Card>
    </div>
  )
}
