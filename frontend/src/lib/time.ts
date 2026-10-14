const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function timeAgo(iso: string | Date | undefined, now: Date = new Date()): string {
  if (!iso) return 'less than a minute ago'
  const d = typeof iso === 'string' ? new Date(iso) : iso
  const sec = Math.round((d.getTime() - now.getTime()) / 1000)
  const min = Math.round(sec / 60)
  const hr = Math.round(min / 60)
  const day = Math.round(hr / 24)
  if (Math.abs(sec) < 60) return 'less than a minute ago'
  if (Math.abs(min) < 60) return rtf.format(min, 'minute')
  if (Math.abs(hr) < 24) return rtf.format(hr, 'hour')
  return rtf.format(day, 'day')
}
