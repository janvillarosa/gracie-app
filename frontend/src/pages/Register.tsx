import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { registerAuth } from '@api/endpoints'
import { Card, Typography, Form, Input, Button, message } from 'antd'
import { useDocumentTitle } from '@lib/useDocumentTitle'
import { BrandLogo } from '@components/BrandLogo'

export const Register: React.FC = () => {
  useDocumentTitle('Register')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  
  const navigate = useNavigate()

  async function onRegister(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await registerAuth(username.trim(), password, name.trim())
      message.success('Account created. Redirecting to login…')
      // Ask them to login afterwards per requirement
      setTimeout(() => navigate('/login', { replace: true }), 800)
    } catch (err: any) {
      message.error(err?.message || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="container">
      <BrandLogo to="/register" />
      <Card className="paper-card">
        <Typography.Title level={2} style={{ marginTop: 0 }}>Create account</Typography.Title>
        <Form layout="vertical" onSubmitCapture={onRegister}>
          <Form.Item label="Email (this will be your username)">
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
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Form.Item>
          <Form.Item label="Display name (optional)">
            <Input
              placeholder="Your name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" disabled={!username || password.length < 8 || loading} size="large" block>
            Create Account
          </Button>
        </Form>
        
        <Typography.Text type="secondary" style={{ display: 'inline-block', paddingTop: 40 }}>
          Already have an account? <Link to="/login" className="link-primary">Log in</Link>
        </Typography.Text>
      </Card>
      </div>
    </div>
  )
}
