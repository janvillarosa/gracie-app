export const NAME_RE = /^[A-Za-z0-9 ]+$/
export const MAX_DISPLAY_NAME = 64
export const MAX_DESCRIPTION = 512

export function isValidDisplayName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_DISPLAY_NAME && NAME_RE.test(name)
}

