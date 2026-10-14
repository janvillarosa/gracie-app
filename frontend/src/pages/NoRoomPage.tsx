import React, { useMemo, useState } from 'react'
import { errorMessage } from '@lib/errors'
import { useAuth } from '@auth/AuthProvider'
import {
  createRoom,
  updateRoomSettings,
  isConflict,
  isForbidden,
  joinRoomByToken,
} from '@api/endpoints'
import { Card, Typography, Form, Input, Button, Space, Grid, Divider, message } from 'antd'
import { Plus, UsersThree } from '@phosphor-icons/react'
import { CreateHouseModal } from '@components/CreateHouseModal'
import { useTransitionNavigate } from '@lib/viewTransition'
import { useDocumentTitle } from '@lib/useDocumentTitle'
import { TopNav } from '@components/TopNav'

const TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ0123456789' // no I, O, L

export const NoRoomPage: React.FC = () => {
  const { apiKey } = useAuth()
  const navigate = useTransitionNavigate()
  useDocumentTitle('Join or create a house')
  const [token, setToken] = useState('')

  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  const tokenValid = useMemo(
    () => token.length === 5 && [...token].every((c) => TOKEN_ALPHABET.includes(c)),
    [token],
  )

  const onCreateWithDetails = async (vals: { display_name?: string; description?: string }) => {
    setCreating(true)
    try {
      await createRoom(apiKey!)
      if (vals.display_name || typeof vals.description === 'string') {
        await updateRoomSettings(apiKey!, {
          display_name: vals.display_name,
          description: vals.description ?? '',
        })
      }
      setCreateOpen(false)
      navigate('/app', { replace: true })
    } catch (e: any) {
      message.error(errorMessage(e, 'Couldn’t create your house. Try again.'))
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
      if (isForbidden(e)) message.error('That code doesn’t match a house. Check it and try again.')
      else if (isConflict(e)) message.error('You’re already a member of this house.')
      else message.error(errorMessage(e, 'Couldn’t join that house. Try again.'))
    } finally {
      setLoading(false)
    }
  }

  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md

  return (
    <div className="container">
      <TopNav />
      <Card className="no-room-card">
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {isMobile ? (
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              <Typography.Title level={2} style={{ margin: 0 }}>
                You are not in a house yet
              </Typography.Title>
            </Space>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography.Title level={2} style={{ margin: 0 }}>
                You are not in a house yet
              </Typography.Title>
            </div>
          )}
          <div className="section">
            <Typography.Title level={3} style={{ marginTop: 0 }}>
              Create a new house
            </Typography.Title>
            <Typography.Text className="no-room-subtitle">
              You’ll be the only member until someone joins with your share code.
            </Typography.Text>
            <Button
              type="primary"
              onClick={() => setCreateOpen(true)}
              disabled={loading}
              icon={<Plus />}
              block
            >
              Create a house
            </Button>
          </div>

          <Divider className="no-room-divider" />

          <div className="section">
            <Typography.Title level={3} style={{ marginTop: 0 }}>
              Join an existing house
            </Typography.Title>
            <Form layout="vertical" onSubmitCapture={onJoin}>
              <Form.Item
                label="House code"
                extra="Ask a housemate for it. They’ll find it under Share code."
              >
                <div className="join-row">
                  <Input
                    placeholder="e.g., K7M2Q"
                    value={token}
                    onChange={(e) =>
                      setToken(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                    }
                    maxLength={5}
                  />
                  {!isMobile && (
                    <Button
                      type="primary"
                      htmlType="submit"
                      disabled={!tokenValid || loading}
                      icon={<UsersThree />}
                    >
                      Join house
                    </Button>
                  )}
                </div>
              </Form.Item>
              {isMobile && (
                <Button
                  type="primary"
                  htmlType="submit"
                  disabled={!tokenValid || loading}
                  icon={<UsersThree />}
                  block
                >
                  Join house
                </Button>
              )}
            </Form>
          </div>
        </Space>
        <CreateHouseModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSubmit={onCreateWithDetails}
          submitting={creating}
        />
      </Card>
    </div>
  )
}
