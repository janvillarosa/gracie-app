import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '@auth/AuthProvider'
import { loginAuth } from '@api/endpoints'

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
      <div className="panel">
        <div className="title">Login</div>
        <div className="spacer" />
        <form className="col" onSubmit={onLogin}>
          <input className="input" placeholder="Email" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input className="input" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="button" disabled={!username || !password || loading}>Login</button>
        </form>
        {error && (
          <>
            <div className="spacer" />
            <div className="error">{error}</div>
          </>
        )}
        <div className="spacer" />
        <div className="muted">
          New here? <Link to="/register">Create an account</Link>
        </div>
      </div>
    </div>
  )
}

