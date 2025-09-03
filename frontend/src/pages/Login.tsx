import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '@auth/AuthProvider'
import { loginAuth } from '@api/endpoints'
import { Card, Typography, Form, Input, Button, Alert } from 'antd'
import { SignIn } from '@phosphor-icons/react'

export const Login: React.FC = () => {
  const { setApiKey } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  async function onLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await loginAuth(username.trim(), password)
      setApiKey(res.api_key)
      navigate('/app', { replace: true })
    } catch (err: any) {
      setError(err?.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container">
      <Card>
        <Typography.Title level={2} style={{ marginTop: 0 }}>Login</Typography.Title>
        <Form layout="vertical" onSubmitCapture={onLogin}>
          <Form.Item label="Email">
            <Input placeholder="Email" value={username} onChange={(e) => setUsername(e.target.value)} />
          </Form.Item>
          <Form.Item label="Password">
            <Input.Password placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Form.Item>
          <Button type="primary" htmlType="submit" disabled={!username || !password || loading} icon={<SignIn />}>Login</Button>
        </Form>
        {error && <><div className="spacer" /><Alert type="error" message={error} showIcon /></>}
        <div className="spacer" />
        <Typography.Text type="secondary">New here? <Link to="/register">Create an account</Link></Typography.Text>
      </Card>
    </div>
  )
}
