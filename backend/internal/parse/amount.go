package parse

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// UnitCount is the unit of a bare number ("2" eggs).
const UnitCount = "count"

// MaxAmountMilli caps a recorded amount (1000 of anything, in thousandths).
const MaxAmountMilli = 1_000_000

// canonicalUnits maps every unit the parser knows to one spelling (singular, short).
var canonicalUnits = func() map[string]string {
	alias := map[string]string{
		"lbs": "lb", "bags": "bag", "bottles": "bottle", "boxes": "box", "packs": "pack", "cans": "can",
		"cups": "cup", "tablespoon": "tbsp", "tablespoons": "tbsp", "teaspoon": "tsp", "teaspoons": "tsp",
		"liter": "l", "liters": "l", "litre": "l", "litres": "l", "gallon": "gal", "gallons": "gal",
		"pieces": "piece", "pc": "piece", "pcs": "piece", "doz": "dozen", "bunches": "bunch", "heads": "head",
		"jars": "jar", "cartons": "carton", "sticks": "stick", "slices": "slice", "loaves": "loaf",
		"rolls": "roll", "sheets": "sheet", "bars": "bar", "tubes": "tube", "cloves": "clove",
	}
	out := map[string]string{}
	for u := range quantityUnits {
		if c, ok := alias[u]; ok {
			out[u] = c
		} else {
			out[u] = u
		}
	}
	return out
}()

// AmountUnits are the canonical units ParseAmount returns, sorted, UnitCount included. It is the
// enum analytics records.
func AmountUnits() []string {
	seen := map[string]bool{UnitCount: true}
	out := []string{UnitCount}
	for _, c := range canonicalUnits {
		if !seen[c] {
			seen[c] = true
			out = append(out, c)
		}
	}
	sort.Strings(out)
	return out
}

var reAmount = regexp.MustCompile(`^(\d+(?:\.\d+)?|\.\d+|\d+/\d+)\s*([a-zA-Z]+)?$`)

// ParseAmount reads an item's quantity (and unit, when it is stored apart) as a number of
// thousandths and a canonical unit: "2" is 2000 count, "1.5 kg" (or "1.5" + "kg") 1500 kg.
// Anything it does not understand ("a few", an unknown unit, more than 1000) is not ok, so free
// text never leaves the item.
func ParseAmount(quantity, unit string) (milli int64, canon string, ok bool) {
	q := strings.TrimSpace(quantity)
	u := strings.ToLower(strings.TrimSpace(unit))
	m := reAmount.FindStringSubmatch(q)
	if m == nil {
		return 0, "", false
	}
	if m[2] != "" {
		if u != "" && u != strings.ToLower(m[2]) {
			return 0, "", false
		}
		u = strings.ToLower(m[2])
	}
	var n float64
	if a, b, frac := strings.Cut(m[1], "/"); frac {
		x, err1 := strconv.ParseFloat(a, 64)
		y, err2 := strconv.ParseFloat(b, 64)
		if err1 != nil || err2 != nil || y == 0 {
			return 0, "", false
		}
		n = x / y
	} else {
		var err error
		if n, err = strconv.ParseFloat(m[1], 64); err != nil {
			return 0, "", false
		}
	}
	milli = int64(n*1000 + 0.5)
	if milli < 0 || milli > MaxAmountMilli {
		return 0, "", false
	}
	if u == "" {
		return milli, UnitCount, true
	}
	c, known := canonicalUnits[u]
	if !known {
		return 0, "", false
	}
	return milli, c, true
}
