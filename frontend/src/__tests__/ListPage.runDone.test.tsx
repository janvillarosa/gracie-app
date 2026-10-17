import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tracker } from '@lib/analytics'
import { CHEERS } from '@lib/shoppingRun'
import { setupRunPage } from './listRun.helpers'

const checkOff = async (name: string) =>
  userEvent.click(await screen.findByRole('checkbox', { name: `Check off ${name}` }))
const announcement = () => screen.queryByRole('dialog', { name: 'Run done' })
const confetti = () => document.querySelectorAll('.confetti-piece').length

describe('ListPage run done', () => {
  it('the key cheers, and two runs in a row never cheer the same', async () => {
    localStorage.setItem('gracie_last_cheer', 'Nice!')
    setupRunPage({ items: ['Milk', 'Eggs', 'Bread'] })
    await checkOff('Milk')
    await checkOff('Eggs')
    await checkOff('Bread')
    const key = within(await screen.findByRole('dialog', { name: 'Run done' })).getByRole('button')
    expect(CHEERS).toContain(key.textContent)
    expect(key).not.toHaveTextContent('Nice!')
    expect(localStorage.getItem('gracie_last_cheer')).toBe(key.textContent)
    await tracker.flush() // send this run's event here, not into the next test
  })

  it('announces once per run: on the last check, dismissed by its key, not again on Clear done', async () => {
    const calls = setupRunPage({ items: ['Milk', 'Eggs', 'Bread'] })
    await checkOff('Milk')
    await checkOff('Eggs')
    await checkOff('Bread')
    const dialog = await screen.findByRole('dialog', { name: 'Run done' })
    expect(dialog.querySelector('.ui-ink-stamp')).toHaveTextContent('Run done')
    expect(dialog).toHaveTextContent('3 items')
    // The key says a different cheer each run ("Nice!", "Huzzah!"...): it is the dialog's one button.
    await userEvent.click(within(dialog).getByRole('button'))
    await waitFor(() => expect(announcement()).not.toBeInTheDocument())
    await userEvent.click(await screen.findByRole('button', { name: 'More list actions' }))
    await userEvent.click(await screen.findByText('Clear completed'))
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: /Bread/ })).not.toBeInTheDocument(),
    )
    expect(announcement()).not.toBeInTheDocument()
    await tracker.flush()
    const marked = calls.events.filter((e) => e.name === 'list.run_stamped')
    expect(marked).toHaveLength(1)
    expect(marked[0].props).toEqual({ items: 3, minutes: 0 })
  })

  it('checking the last item outside a run announces nothing', async () => {
    setupRunPage({ items: ['Milk', 'Eggs'] })
    await checkOff('Milk')
    await checkOff('Eggs')
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: 'Check off Eggs' })).not.toBeInTheDocument(),
    )
    expect(announcement()).not.toBeInTheDocument()
  })

  it('Clear done during a run with items left announces it', async () => {
    setupRunPage({ items: ['Milk', 'Eggs', 'Bread', 'Tea'] })
    await checkOff('Milk')
    await checkOff('Eggs')
    await checkOff('Bread')
    expect(announcement()).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'More list actions' }))
    await userEvent.click(await screen.findByText('Clear completed'))
    expect(await screen.findByRole('dialog', { name: 'Run done' })).toHaveTextContent('3 items')
  })

  it('a quick run against learned habits says so', async () => {
    setupRunPage({
      items: ['Milk', 'Eggs', 'Bread'],
      hint: { typical: { minutes: 25, items: 10 } },
    })
    await checkOff('Milk')
    await checkOff('Eggs')
    await checkOff('Bread')
    expect(await screen.findByRole('dialog', { name: 'Run done' })).toHaveTextContent(
      '25 min quicker than usual',
    )
  })

  it('the check that finishes a run lets the stamp celebrate, not the confetti', async () => {
    setupRunPage({ items: ['Milk', 'Eggs', 'Bread', 'Tea'] })
    await checkOff('Milk')
    await checkOff('Eggs')
    await checkOff('Bread')
    const before = confetti()
    expect(before).toBeGreaterThan(0) // ordinary check-offs still throw confetti
    await checkOff('Tea')
    await screen.findByRole('dialog', { name: 'Run done' })
    expect(confetti()).toBeLessThanOrEqual(before)
  })
})
