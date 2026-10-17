import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tracker } from '@lib/analytics'
import { setupRunPage } from './listRun.helpers'

const checkOff = async (name: string) =>
  userEvent.click(await screen.findByRole('checkbox', { name: `Check off ${name}` }))
const slip = () => screen.queryByRole('status', { name: /Run done/ })

describe('ListPage run-done slip', () => {
  it('slip lands once per run: on the last check, not again on Clear done', async () => {
    const calls = setupRunPage({ items: ['Milk', 'Eggs', 'Bread'] })
    await checkOff('Milk')
    await checkOff('Eggs')
    await checkOff('Bread')
    expect(await screen.findByRole('status', { name: /Run done/ })).toHaveTextContent('3 items')
    await userEvent.click(slip()!)
    await waitFor(() => expect(slip()).not.toBeInTheDocument())
    await userEvent.click(await screen.findByRole('button', { name: 'More list actions' }))
    await userEvent.click(await screen.findByText('Clear completed'))
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: /Bread/ })).not.toBeInTheDocument(),
    )
    expect(slip()).not.toBeInTheDocument()
    await tracker.flush()
    const marked = calls.events.filter((e) => e.name === 'list.run_stamped')
    expect(marked).toHaveLength(1)
    expect(marked[0].props).toEqual({ items: 3, minutes: 0 })
  })

  it('checking the last item outside a run lands nothing', async () => {
    setupRunPage({ items: ['Milk', 'Eggs'] })
    await checkOff('Milk')
    await checkOff('Eggs')
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: 'Check off Eggs' })).not.toBeInTheDocument(),
    )
    expect(slip()).not.toBeInTheDocument()
  })

  it('Clear done during a run with items left lands the slip', async () => {
    setupRunPage({ items: ['Milk', 'Eggs', 'Bread', 'Tea'] })
    await checkOff('Milk')
    await checkOff('Eggs')
    await checkOff('Bread')
    expect(slip()).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'More list actions' }))
    await userEvent.click(await screen.findByText('Clear completed'))
    expect(await screen.findByRole('status', { name: /Run done/ })).toHaveTextContent('3 items')
  })

  it('a quick run against learned habits says so', async () => {
    setupRunPage({
      items: ['Milk', 'Eggs', 'Bread'],
      hint: { typical: { minutes: 25, items: 10 } },
    })
    await checkOff('Milk')
    await checkOff('Eggs')
    await checkOff('Bread')
    expect(await screen.findByRole('status', { name: /Run done/ })).toHaveTextContent(
      '25 min quicker than usual',
    )
  })

  it('says what the run got, in the category colours', async () => {
    setupRunPage({
      items: [
        { description: 'Milk', category: 'Dairy' },
        { description: 'Eggs', category: 'Dairy' },
        { description: 'Bread', category: 'Bakery' },
      ],
    })
    await checkOff('Milk')
    await checkOff('Eggs')
    await checkOff('Bread')
    const done = await screen.findByRole('status', { name: /Run done/ })
    expect(done).toHaveTextContent('Dairy ×2')
    expect(done).toHaveTextContent('Bakery ×1')
    expect(done.querySelector('.cat-dairy')).not.toBeNull()
    expect(done.querySelector('.cat-bakery')).not.toBeNull()
  })
})
