export const NAME_RE = /^[A-Za-z0-9 ]+$/
export const MAX_DISPLAY_NAME = 64
export const MAX_DESCRIPTION = 512

export function isValidDisplayName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_DISPLAY_NAME && NAME_RE.test(name)
}

// Shared field rules, so the label hint, inline error and toast all say the same thing.
export const NAME_RULE = 'Use up to 64 letters, numbers or spaces.'
export const DESCRIPTION_RULE = `Keep the description under ${MAX_DESCRIPTION} characters.`
