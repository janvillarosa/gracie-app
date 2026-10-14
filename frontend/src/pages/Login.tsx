import React, { useState } from 'react'
import { errorMessage } from '@lib/errors'
import { useTransitionNavigate } from '@lib/viewTransition'
import { TransitionLink } from '@components/TransitionLink'
import { useAuth } from '@auth/AuthProvider'
import { loginAuth } from '@api/endpoints'
import { Form, Input, Button, Typography, message } from 'antd'
import { useDocumentTitle } from '@lib/useDocumentTitle'
import { AuthShell } from '@components/AuthShell'
import { startWelcome } from '@lib/welcome'

export const Login: React.FC = () => {
  const { setApiKey } = useAuth()
  useDocumentTitle('Log in')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useTransitionNavigate()
  // Autofocus only where there is no on-screen keyboard to cover the form.
  const finePointer = window.matchMedia?.('(pointer: fine)').matches ?? false

  async function onLogin(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    try {
      const res = await loginAuth(username.trim(), password)
      setApiKey(res.api_key)
      startWelcome()
      navigate('/app', { replace: true })
    } catch (err: any) {
      message.error(
        err?.status === 400 || err?.status === 401 || err?.status === 403
          ? 'That email and password don’t match. Check them and try again.'
          : errorMessage(err, 'Couldn’t log you in. Try again.'),
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title="Log in"
      logoTo="/login"
      footer={
        <Typography.Text type="secondary">
          New here?{' '}
          <TransitionLink to="/register" className="link-primary">
            Create an account
          </TransitionLink>
        </Typography.Text>
      }
    >
      <Form layout="vertical" onSubmitCapture={onLogin}>
        <Form.Item label="Email">
          <Input
            placeholder="you@example.com"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="email"
            inputMode="email"
            autoFocus={finePointer}
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
        <Button
          type="primary"
          htmlType="submit"
          disabled={!username || !password}
          loading={loading}
          size="large"
          block
        >
          Log in
        </Button>
      </Form>
    </AuthShell>
  )
}
