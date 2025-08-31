import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { registerAuth } from '@api/endpoints'

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
      <div className="panel">
        <div className="title">Create account</div>
        <div className="spacer" />
        <form className="col" onSubmit={onRegister}>
          <input className="input" placeholder="Email (username)" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input className="input" placeholder="Password (min 8 chars)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <input className="input" placeholder="Display name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="button" disabled={!username || password.length < 8 || loading}>Register</button>
        </form>
        {error && (
          <>
            <div className="spacer" />
            <div className="error">{error}</div>
          </>
        )}
        {success && (
          <>
            <div className="spacer" />
            <div>Account created. Redirecting to login…</div>
          </>
        )}
        <div className="spacer" />
        <div className="muted">
          Already have an account? <Link to="/login">Login</Link>
        </div>
      </div>
    </div>
  )
}

