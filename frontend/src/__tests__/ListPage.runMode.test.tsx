import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { setupRunPage } from './listRun.helpers'

const eggs = { key: 'eggs', description: 'Eggs', every_days: 7, score: 0.8, due_in_days: 3 }

const checkOff = async (name: string) =>
  userEvent.click(await screen.findByRole('checkbox', { name: `Check off ${name}` }))

describe('ListPage run mode', () => {
  it('after three check-offs asks for run-mode suggestions and says when it is due', async () => {
    const calls = setupRunPage({ items: ['Milk', 'Bread', 'Tea', 'Jam'], run: [eggs] })
    await checkOff('Milk')
    await checkOff('Bread')
    expect(calls.suggestionModes).not.toContain('run')
    await checkOff('Tea')
    const region = await screen.findByRole('region', { name: 'Suggestion' })
    expect(region).toHaveTextContent('Eggs')
    expect(region).toHaveTextContent('Usually due in 3 days')
    expect(calls.suggestionModes).toContain('run')
  })

  it('ignoring in run mode tells the server it was during a run', async () => {
    const calls = setupRunPage({ items: ['Milk', 'Bread', 'Tea', 'Jam'], run: [eggs] })
    await checkOff('Milk')
    await checkOff('Bread')
    await checkOff('Tea')
    await userEvent.click(await screen.findByRole('button', { name: /Ignore suggestion: Eggs/ }))
    await waitFor(() => expect(calls.ignored).toEqual([{ key: 'eggs', during: 'run' }]))
  })

  it('starts on the second check when the hint says it is their usual time', async () => {
    const calls = setupRunPage({ hint: { checks_to_start: 2 }, run: [eggs] })
    await checkOff('Milk')
    await checkOff('Bread')
    await screen.findByText('Usually due in 3 days')
    expect(calls.suggestionModes).toContain('run')
  })

  it('unchecking does not count toward a run', async () => {
    const calls = setupRunPage({ items: ['Milk', 'Bread', 'Tea', 'Jam'], run: [eggs] })
    await checkOff('Milk')
    await userEvent.click(await screen.findByRole('button', { name: /Show checked-off items/ }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Uncheck Milk' }))
    await checkOff('Bread')
    await waitFor(() => expect(calls.patched).toHaveLength(3))
    expect(calls.suggestionModes).not.toContain('run')
  })

  it('a failing hint falls back to three check-offs, a minute apart (past the tidying filter)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const t = Date.now()
      const calls = setupRunPage({ hint: null, run: [eggs] })
      await checkOff('Milk')
      vi.setSystemTime(t + 60_000)
      await checkOff('Bread')
      expect(calls.suggestionModes).not.toContain('run')
      vi.setSystemTime(t + 120_000)
      await checkOff('Tea')
      await screen.findByText('Usually due in 3 days')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a failing hint still filters out a tidying burst', async () => {
    const calls = setupRunPage({ hint: null, run: [eggs] })
    await checkOff('Milk')
    await checkOff('Bread')
    await checkOff('Tea')
    await waitFor(() => expect(calls.patched).toHaveLength(3))
    expect(calls.suggestionModes).not.toContain('run')
  })
})
