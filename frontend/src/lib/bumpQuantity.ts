const plain = /^\d+(\.\d+)?$/

/**
 * The quantity an item on the list should have after its add-bar slip is picked again, or
 * null to leave it alone. No quantity counts as one. The typed amount is added when its unit
 * matches the item's (or neither has one); otherwise it is one more. A quantity that isn't a
 * plain number ("a few", "1/2") is left alone.
 */
export function bumpQuantity(
  item: { quantity?: string; unit?: string },
  typed: { quantity?: string; unit?: string },
): string | null {
  const cur = item.quantity?.trim() || '1'
  if (!plain.test(cur)) return null
  const t = typed.quantity?.trim() ?? ''
  const by = plain.test(t) && (typed.unit || '') === (item.unit || '') ? Number(t) : 1
  return String(Math.round((Number(cur) + by) * 100) / 100)
}
