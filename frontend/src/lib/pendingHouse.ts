// The House name a visitor typed on the landing page, kept in this tab (sessionStorage) until
// they create their first House. Reading it consumes it.
export const PENDING_HOUSE_KEY = 'bauhouse_pending_house'

export function takePendingHouse(): string {
  try {
    const v = sessionStorage.getItem(PENDING_HOUSE_KEY) ?? ''
    sessionStorage.removeItem(PENDING_HOUSE_KEY)
    return v
  } catch {
    return ''
  }
}
