/**
 * Known quantity units. A word after a number is only treated as a unit
 * if it appears in this list (case-insensitive). Any other word (e.g. "bell",
 * "large", "red") is NOT a unit and stays part of the description.
 */
export const QUANTITY_UNITS = new Set([
    'kg', 'g', 'lb', 'lbs', 'oz',
    'bag', 'bags',
    'bottle', 'bottles',
    'box', 'boxes',
    'pack', 'packs',
    'can', 'cans',
    'cup', 'cups',
    'tbsp', 'tablespoon', 'tablespoons',
    'tsp', 'teaspoon', 'teaspoons',
    'ml', 'l', 'liter', 'liters', 'litre', 'litres',
    'gal', 'gallon', 'gallons',
    'piece', 'pieces', 'pc', 'pcs',
    'dozen', 'doz',
    'bunch', 'bunches',
    'head', 'heads',
    'jar', 'jars',
    'carton', 'cartons',
    'stick', 'sticks',
    'slice', 'slices',
    'loaf', 'loaves',
    'roll', 'rolls',
    'sheet', 'sheets',
    'bar', 'bars',
    'tube', 'tubes',
    'clove', 'cloves',
])

export interface ParsedInput {
    description: string
    quantity: string
    unit: string
}

/**
 * Parses a free-text list item input into structured quantity, unit, and description.
 *
 * Supported formats:
 *   "3 bags Milk"       → { quantity: "3",   unit: "bags",  description: "Milk" }
 *   "1.5kg Beef"        → { quantity: "1.5", unit: "kg",    description: "Beef" }
 *   "2 bell peppers"    → { quantity: "2",   unit: "",      description: "bell peppers" }
 *   "5 large eggs"      → { quantity: "5",   unit: "",      description: "large eggs" }
 *   "Milk"              → { quantity: "",    unit: "",      description: "Milk" }
 *   "bell peppers"      → { quantity: "",    unit: "",      description: "bell peppers" }
 *
 * The key rule: a word is only treated as a unit if it is in the QUANTITY_UNITS
 * allowlist. Descriptive words like "bell", "large", "red" are not units.
 */
export function parseInput(input: string): ParsedInput {
    const trimmed = input.trim()

    // Match: optional number, then optional word (potential unit), then the rest
    // Group 1: leading number (int or decimal)
    // Group 2: first word after the number (no spaces), attached directly (e.g. "1.5kg") or space-separated
    // Group 3: the remainder of the string
    const regex = /^([\d.]+)\s*([a-zA-Z]+)\s+(.+)$/
    const match = trimmed.match(regex)

    if (match) {
        const qty = match[1]
        const word = match[2]
        const rest = match[3].trim()

        if (QUANTITY_UNITS.has(word.toLowerCase())) {
            // Word is a recognised unit
            return { quantity: qty, unit: word, description: rest }
        } else {
            // Word is NOT a unit (e.g. "bell", "large", "red") — keep it in description
            return { quantity: qty, unit: '', description: `${word} ${rest}` }
        }
    }

    // Also handle "1.5kg" with NO space between number and unit and NO rest — treat as just quantity+unit, no description
    // But more importantly handle inputs with no leading number: treat as plain description
    return { quantity: '', unit: '', description: trimmed }
}
