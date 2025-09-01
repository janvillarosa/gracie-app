import React, { useMemo, useState } from 'react'
import { useAuth } from '@auth/AuthProvider'
import { createRoom, isConflict, isForbidden, joinRoomByToken } from '@api/endpoints'
import { Card, Typography, Row, Col, Form, Input, Button, Alert, Space, Grid } from 'antd'

const TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ0123456789' // no I, O, L

export const NoRoomPage: React.FC = () => {
  const { apiKey, setApiKey } = useAuth()
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const tokenValid = useMemo(() => token.length === 5 && [...token].every((c) => TOKEN_ALPHABET.includes(c)), [token])

  const onCreate = async () => {
    setError(null)
    setLoading(true)
    try {
      await createRoom(apiKey!)
      window.location.reload()
    } catch (e: any) {
      setError(e?.message || 'Failed to create house')
    } finally {
      setLoading(false)
    }
  }

  const onJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await joinRoomByToken(apiKey!, token.trim().toUpperCase())
      window.location.reload()
    } catch (e: any) {
      if (isForbidden(e)) setError('Invalid code for this house.')
      else if (isConflict(e)) setError('Join not allowed: the house may be full.')
      else setError(e?.message || 'Failed to join house')
    } finally {
      setLoading(false)
    }
  }

  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md

  return (
    <div className="container">
      <Card>
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {isMobile ? (
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              <Typography.Title level={3} style={{ margin: 0 }}>You are not in a house yet</Typography.Title>
              <Space wrap>
                <Button onClick={() => setApiKey(null)}>Logout</Button>
              </Space>
            </Space>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography.Title level={3} style={{ margin: 0 }}>You are not in a house yet</Typography.Title>
              <Button onClick={() => setApiKey(null)}>Logout</Button>
            </div>
          )}
          <Row gutter={16} align="top">
            <Col xs={24} md={12} style={{ order: isMobile ? 2 : 1 }}>
              <Space direction="vertical">
                <Typography.Title level={4} style={{ marginTop: 0 }}>Create a new house</Typography.Title>
                <Button type="primary" onClick={onCreate} disabled={loading}>Create solo house</Button>
                <Typography.Text type="secondary">You will be the only member until someone joins.</Typography.Text>
              </Space>
            </Col>
            <Col xs={24} md={12} style={{ order: isMobile ? 1 : 2 }}>
              <Typography.Title level={4} style={{ marginTop: 0 }}>Join an existing house</Typography.Title>
              <Form layout="vertical" onSubmitCapture={onJoin}>
                <Form.Item label="5-char code (no I/O/L)">
                  <Input
                    placeholder="5-char code (no I/O/L)"
                    value={token}
                    onChange={(e) => setToken(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                    maxLength={5}
                  />
                </Form.Item>
                <Button type="primary" htmlType="submit" disabled={!tokenValid || loading}>Join house</Button>
              </Form>
            </Col>
          </Row>
          {error && <Alert type="error" message={error} showIcon />}
        </Space>
      </Card>
    </div>
  )
}
