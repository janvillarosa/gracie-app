import React, { useEffect, useState } from 'react'
import { Switch, Typography, message } from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getMe, setMyPreferences } from '@api/endpoints'
import type { User } from '@api/types'
import { useAuth } from '@auth/AuthProvider'
import { errorMessage } from '@lib/errors'

function useOnline(): boolean {
  const [on, setOn] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false)
  useEffect(() => {
    const up = () => setOn(true)
    const down = () => setOn(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return on
}

/** "Show next stop when I'm travelling": an account preference, so it follows you across
 *  devices. Updates at once and rolls back with a message if the server says no. */
export const TripsPreference: React.FC = () => {
  const { apiKey } = useAuth()
  const qc = useQueryClient()
  const me = useQuery<User>({ queryKey: ['me'], queryFn: () => getMe(apiKey as string) })
  const online = useOnline()
  const on = me.data?.preferences?.trips_show_next_stop !== false

  const change = async (next: boolean) => {
    const before = qc.getQueryData<User>(['me'])
    qc.setQueryData<User | undefined>(['me'], (u) =>
      u ? { ...u, preferences: { ...u.preferences, trips_show_next_stop: next } } : u,
    )
    try {
      const saved = await setMyPreferences(apiKey as string, { trips_show_next_stop: next })
      if (saved && typeof saved === 'object' && 'user_id' in saved) qc.setQueryData(['me'], saved)
    } catch (e) {
      qc.setQueryData(['me'], before)
      message.error(errorMessage(e, 'Couldn’t save that. Try again.'))
    }
  }

  return (
    <div className="trips-pref">
      <div className="trips-pref-row">
        <label htmlFor="trips-show-next" className="trips-pref-label">
          Show next stop when I’m travelling
        </label>
        <Switch
          id="trips-show-next"
          checked={on}
          disabled={!online || me.isLoading}
          onChange={change}
          aria-describedby="trips-show-next-help"
        />
      </div>
      <Typography.Text type="secondary" id="trips-show-next-help">
        {online
          ? 'Opens your trips on the next place to go. Applies to all your trips.'
          : 'Connect to change this.'}
      </Typography.Text>
    </div>
  )
}
