const DEFAULT_BASE = '/api'

export type ApiError = Error & { status?: number }

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { apiKey?: string | null } = {}
): Promise<T> {
  const base = import.meta.env.VITE_API_BASE_URL ?? DEFAULT_BASE
  const url = `${base}${path}`
  const { apiKey, headers, ...rest } = options
  const resp = await fetch(url, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(headers || {}),
    },
  })
  if (!resp.ok) {
    let message = resp.statusText
    try {
      const data = (await resp.json()) as any
      message = data?.error || message
    } catch {}
    const err = new Error(message) as ApiError
    err.status = resp.status
    throw err
  }
  const ct = resp.headers.get('content-type') || ''
  if (ct.includes('application/json')) return (await resp.json()) as T
  // @ts-expect-error allow empty responses
  return undefined
}

