package parse

import (
	"regexp"
	"strings"
)

var quantityUnits = map[string]struct{}{
	"kg": {}, "g": {}, "lb": {}, "lbs": {}, "oz": {},
	"bag": {}, "bags": {},
	"bottle": {}, "bottles": {},
	"box": {}, "boxes": {},
	"pack": {}, "packs": {},
	"can": {}, "cans": {},
	"cup": {}, "cups": {},
	"tbsp": {}, "tablespoon": {}, "tablespoons": {},
	"tsp": {}, "teaspoon": {}, "teaspoons": {},
	"ml": {}, "l": {}, "liter": {}, "liters": {}, "litre": {}, "litres": {},
	"gal": {}, "gallon": {}, "gallons": {},
	"piece": {}, "pieces": {}, "pc": {}, "pcs": {},
	"dozen": {}, "doz": {},
	"bunch": {}, "bunches": {},
	"head": {}, "heads": {},
	"jar": {}, "jars": {},
	"carton": {}, "cartons": {},
	"stick": {}, "sticks": {},
	"slice": {}, "slices": {},
	"loaf": {}, "loaves": {},
	"roll": {}, "rolls": {},
	"sheet": {}, "sheets": {},
	"bar": {}, "bars": {},
	"tube": {}, "tubes": {},
	"clove": {}, "cloves": {},
}

var leadingQty = regexp.MustCompile(`^([\d.]+)\s*([a-zA-Z]+)\s+(.+)$`)

// ParseInput splits input into (description, quantity, unit).
// Regex: ^([\d.]+)\s*([a-zA-Z]+)\s+(.+)$
// If match and word in QUANTITY_UNITS (case-insensitive): return (rest, qty, word)
// If match and word NOT in QUANTITY_UNITS: return (word+" "+rest, qty, "")
// No match: return (strings.TrimSpace(input), "", "")
func ParseInput(input string) (description, quantity, unit string) {
	trimmed := strings.TrimSpace(input)
	match := leadingQty.FindStringSubmatch(trimmed)

	if match == nil {
		return trimmed, "", ""
	}

	qty := match[1]
	word := match[2]
	rest := strings.TrimSpace(match[3])

	if _, ok := quantityUnits[strings.ToLower(word)]; ok {
		return rest, qty, word
	}

	return word + " " + rest, qty, ""
}

// NormalizeKey: lowercase + collapse internal whitespace + trim + strip leading qty/unit via ParseInput.
func NormalizeKey(input string) string {
	desc, _, _ := ParseInput(input)
	desc = strings.ToLower(desc)
	desc = strings.Join(strings.Fields(desc), " ")
	return desc
}
