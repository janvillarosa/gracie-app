import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listTestActions, runTestAction } from '@api/endpoints'
import { useAuth } from '@auth/AuthProvider'
import { Button, DetailGroup } from '@components/ui'
import { errorMessage } from '@lib/errors'

/** Test mode (test accounts only): one row per action the server offers, a Run button, and what
 *  the last run said. The server owns the list, the wording and who may run what, so a refusal
 *  (housemates in the House, rate limit) is shown as it comes. */
export const TestModePanel: React.FC = () => {
  const { apiKey } = useAuth()
  const actions = useQuery({
    queryKey: ['test-actions'],
    queryFn: () => listTestActions(apiKey as string),
    retry: false,
  })
  const [running, setRunning] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})

  const run = async (id: string) => {
    if (running) return
    setRunning(id)
    let text: string
    try {
      text = (await runTestAction(apiKey as string, id)).message
    } catch (e) {
      text = errorMessage(e, 'Couldn’t run that. Try again.')
    }
    setResults((r) => ({ ...r, [id]: text }))
    setRunning(null)
  }

  if (!actions.data) return null
  return (
    <DetailGroup label="Test mode">
      {actions.data.actions.map((a) => (
        <div className="pref" key={a.id}>
          <div className="pref-row">
            <span className="pref-label" id={`test-${a.id}`}>
              {a.label}
            </span>
            <Button
              kind="quiet"
              aria-labelledby={`test-${a.id}-run test-${a.id}`}
              id={`test-${a.id}-run`}
              onClick={() => void run(a.id)}
              disabled={running !== null}
            >
              {running === a.id ? 'Running…' : 'Run'}
            </Button>
          </div>
          <p className="pref-help">{a.description}</p>
          <p className="pref-help test-result" role="status" aria-live="polite">
            {results[a.id] ?? ''}
          </p>
        </div>
      ))}
    </DetailGroup>
  )
}
