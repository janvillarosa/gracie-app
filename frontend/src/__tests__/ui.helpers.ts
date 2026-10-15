import { expect } from 'vitest'

/** A sheet has at most one yellow key button: the one thing to do. */
export function expectAtMostOneKey(root: Element) {
  expect(root.querySelectorAll('.ui-btn.is-key').length).toBeLessThanOrEqual(1)
}
