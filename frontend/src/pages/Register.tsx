import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { registerAuth } from '@api/endpoints'
import { Card, Typography, Form, Input, Button, Alert } from 'antd'
import { UserPlus } from '@phosphor-icons/react'

export const Register: React.FC = () => {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const navigate = useNavigate()

  async function onRegister(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await registerAuth(username.trim(), password, name.trim())
      setSuccess(true)
      // Ask them to login afterwards per requirement
      setTimeout(() => navigate('/login', { replace: true }), 800)
    } catch (err: any) {
      setError(err?.message || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container">
      <Card>
        <Typography.Title level={2} style={{ marginTop: 0 }}>Create account</Typography.Title>
        <Form layout="vertical" onSubmitCapture={onRegister}>
          <Form.Item label="Email (username)">
            <Input placeholder="Email (username)" value={username} onChange={(e) => setUsername(e.target.value)} />
          </Form.Item>
          <Form.Item label="Password (min 8 chars)">
            <Input.Password placeholder="Password (min 8 chars)" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Form.Item>
          <Form.Item label="Display name (optional)">
            <Input placeholder="Display name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
          </Form.Item>
          <Button type="primary" htmlType="submit" disabled={!username || password.length < 8 || loading} icon={<UserPlus />}>Register</Button>
        </Form>
        {error && <><div className="spacer" /><Alert type="error" message={error} showIcon /></>}
        {success && <><div className="spacer" /><Alert type="success" message="Account created. Redirecting to login…" showIcon /></>}
        <div className="spacer" />
        <Typography.Text type="secondary">Already have an account? <Link to="/login">Login</Link></Typography.Text>
      </Card>
    </div>
  )
}
