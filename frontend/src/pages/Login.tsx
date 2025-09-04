import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '@auth/AuthProvider'
import { loginAuth } from '@api/endpoints'
import { Card, Typography, Form, Input, Button, message } from 'antd'

export const Login: React.FC = () => {
  const { setApiKey } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function onLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await loginAuth(username.trim(), password)
      setApiKey(res.api_key)
      navigate('/app', { replace: true })
    } catch (err: any) {
      message.error(err?.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="container">
      <Card className="paper-card">
        <Typography.Title level={2} style={{ marginTop: 0 }}>Welcome</Typography.Title>
        <Form layout="vertical" onSubmitCapture={onLogin}>
          <Form.Item label="Email">
            <Input
              placeholder="you@example.com"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="email"
              inputMode="email"
            />
          </Form.Item>
          <Form.Item label="Password">
            <Input.Password
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" disabled={!username || !password || loading} size="large" block>
            Log In
          </Button>
        </Form>
        <Typography.Text type="secondary" style={{ display: 'inline-block', paddingTop: 40 }}>
          New here? <Link to="/register" className="link-primary">Create an account</Link>
        </Typography.Text>
      </Card>
      </div>
    </div>
  )
}
