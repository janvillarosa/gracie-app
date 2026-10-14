// Server errors arrive as bare tokens ("unauthorized", "bad request"). Those say nothing
// useful to a person, so only a real sentence from the server is shown; anything else
// falls back to the caller's message, which names the action and the way to recover.
const GENERIC =
  /^(bad request|conflict|forbidden|not found|unauthorized|internal server error|failed to fetch|load failed|network ?error.*)$/i

export const OFFLINE_MESSAGE =
  'Can’t reach Bauhouse right now. Check your connection and try again.'

export function errorMessage(err: unknown, fallback: string): string {
  const e = err as { status?: number; message?: string } | null | undefined
  if (e?.status === 401) return 'Your session expired. Log in again to continue.'
  if ((typeof e?.status === 'number' && e.status >= 500) || err instanceof TypeError) {
    return OFFLINE_MESSAGE
  }
  const m = e?.message?.trim()
  if (!m || GENERIC.test(m)) return fallback
  return m
}
