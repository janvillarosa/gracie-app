import React, { useEffect, useState } from 'react'
import { message } from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getNotificationPrefs, setNotificationPrefs } from '@api/endpoints'
import type { NotificationPrefs } from '@api/types'
import { useAuth } from '@auth/AuthProvider'
import { Button, DetailGroup, Switch } from '@components/ui'
import { errorMessage } from '@lib/errors'
import { IOS_INSTALL_STEPS } from '@lib/installPrompt'
import { disablePush, enablePush, isPushOn, pushSupport, type PushSupport } from '@lib/push'

const KINDS: { key: keyof NotificationPrefs; label: string; help: string }[] = [
  { key: 'itemAdds', label: 'Housemates add things', help: 'One note for a few adds in a row.' },
  { key: 'autopilot', label: 'Autopilot adds things', help: 'When it fills a list for you.' },
  { key: 'tripReminders', label: 'Trip reminders', help: 'When a to-do or booking is due.' },
]

const PREFS_KEY = ['notification-prefs']

/** Notifications in Account settings. Off on this device: one line and the "Turn on
 *  notifications" key. On: the three kinds as switches (they follow the account to every device
 *  that has them on) and a way to turn this device off. Otherwise, why not: Add to Home Screen
 *  first (iPhone and iPad), blocked in settings, or no support in this browser. */
export const NotificationsPreference: React.FC = () => {
  const { apiKey } = useAuth()
  const [support, setSupport] = useState<PushSupport>(() => pushSupport())
  const [on, setOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    isPushOn().then(
      (v) => live && setOn(v),
      () => live && setOn(false),
    )
    return () => {
      live = false
    }
  }, [])

  const turnOn = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await enablePush(apiKey as string)
      if (r === 'on') setOn(true)
      else if (r === 'denied') setSupport('denied')
      else if (r === 'unsupported') {
        const now = pushSupport()
        setSupport(now === 'ok' ? 'unsupported' : now)
      }
    } catch (e) {
      message.error(errorMessage(e, 'Couldn’t turn on notifications. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  const turnOff = async () => {
    setBusy(true)
    await disablePush(apiKey)
    setOn(false)
    setBusy(false)
  }

  let body: React.ReactNode
  if (support === 'needs-install') {
    body = (
      <div className="pref">
        <span className="pref-label">Add Bauhouse to your Home Screen first</span>
        <p className="pref-help">
          On an iPhone or iPad, notifications come only to the Home Screen app.
        </p>
        <ol className="notify-steps">
          {IOS_INSTALL_STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
          <li>Open Bauhouse from your Home Screen and turn notifications on here.</li>
        </ol>
      </div>
    )
  } else if (support === 'denied') {
    body = (
      <div className="pref">
        <span className="pref-label">Notifications are blocked</span>
        <p className="pref-help">
          Allow them for Bauhouse in your browser or phone settings, then come back here.
        </p>
      </div>
    )
  } else if (support === 'unsupported') {
    body = (
      <div className="pref">
        <span className="pref-label">Not in this browser</span>
        <p className="pref-help">This browser can’t show notifications from Bauhouse.</p>
      </div>
    )
  } else if (on) {
    body = <NotificationKinds busy={busy} onTurnOff={turnOff} />
  } else {
    body = (
      <div className="pref notify-off">
        <p className="pref-help">
          Hear when housemates or autopilot add things, and before trip plans are due. Even with
          Bauhouse closed.
        </p>
        <Button kind="key" onClick={turnOn} disabled={busy || on === null}>
          {busy ? 'Turning on…' : 'Turn on notifications'}
        </Button>
      </div>
    )
  }

  return <DetailGroup label="Notifications">{body}</DetailGroup>
}

/** The three kinds, saved as they change (rolled back with a message if the server says no). */
const NotificationKinds: React.FC<{ busy: boolean; onTurnOff: () => void }> = ({
  busy,
  onTurnOff,
}) => {
  const { apiKey } = useAuth()
  const qc = useQueryClient()
  const prefs = useQuery<NotificationPrefs>({
    queryKey: PREFS_KEY,
    queryFn: () => getNotificationPrefs(apiKey as string),
  })

  const change = async (key: keyof NotificationPrefs, value: boolean) => {
    const before = qc.getQueryData<NotificationPrefs>(PREFS_KEY)
    if (!before) return
    const next = { ...before, [key]: value }
    qc.setQueryData(PREFS_KEY, next)
    try {
      await setNotificationPrefs(apiKey as string, next)
    } catch (e) {
      qc.setQueryData(PREFS_KEY, before)
      message.error(errorMessage(e, 'Couldn’t save that. Try again.'))
    }
  }

  return (
    <>
      {KINDS.map((k) => (
        <div className="pref" key={k.key}>
          <div className="pref-row">
            <label htmlFor={`notify-${k.key}`} className="pref-label">
              {k.label}
            </label>
            <Switch
              id={`notify-${k.key}`}
              checked={prefs.data?.[k.key] ?? false}
              disabled={!prefs.data}
              onChange={(v) => void change(k.key, v)}
              aria-describedby={`notify-${k.key}-help`}
            />
          </div>
          <p className="pref-help" id={`notify-${k.key}-help`}>
            {k.help}
          </p>
        </div>
      ))}
      <div className="pref notify-device">
        <Button kind="text" onClick={onTurnOff} disabled={busy}>
          {busy ? 'Turning off…' : 'Turn off on this device'}
        </Button>
      </div>
    </>
  )
}
