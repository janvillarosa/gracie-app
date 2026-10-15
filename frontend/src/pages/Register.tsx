import React, { useState } from 'react'
import { errorMessage } from '@lib/errors'
import { useTransitionNavigate } from '@lib/viewTransition'
import { TransitionLink } from '@components/TransitionLink'
import { registerAuth } from '@api/endpoints'
import { Form, Input, Button, Typography, message } from 'antd'
import { useDocumentTitle } from '@lib/useDocumentTitle'
import { AuthShell } from '@components/AuthShell'

export const Register: React.FC = () => {
  useDocumentTitle('Register')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  const navigate = useTransitionNavigate()
  const finePointer = window.matchMedia?.('(pointer: fine)').matches ?? false

  async function onRegister(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    try {
      await registerAuth(username.trim(), password, name.trim())
      message.success('Account created. Log in to continue.')
      // Ask them to login afterwards per requirement
      setTimeout(() => navigate('/login', { replace: true }), 800)
    } catch (err: any) {
      message.error(
        err?.status === 409
          ? 'An account with that email already exists. Try logging in instead.'
          : errorMessage(err, 'Couldn’t create your account. Try again.'),
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title="Create account"
      footer={
        <Typography.Text type="secondary">
          Already have an account?{' '}
          <TransitionLink to="/login" className="link-primary">
            Log in
          </TransitionLink>
        </Typography.Text>
      }
    >
      <Form layout="vertical" onSubmitCapture={onRegister}>
        <Form.Item label="Email (this will be your username)">
          <Input
            placeholder="you@example.com"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="email"
            inputMode="email"
            autoFocus={finePointer}
          />
        </Form.Item>
        <Form.Item label="Password" extra="Use at least 8 characters.">
          <Input.Password
            placeholder="Create a password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Form.Item>
        <Form.Item label="Display name (optional)">
          <Input
            placeholder="What your housemates will see"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        </Form.Item>
        <Button
          type="primary"
          htmlType="submit"
          disabled={!username || password.length < 8}
          loading={loading}
          size="large"
          block
        >
          Create account
        </Button>
      </Form>
    </AuthShell>
  )
}
