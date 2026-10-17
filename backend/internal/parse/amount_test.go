package parse

import (
	"slices"
	"testing"
)

func TestParseAmount(t *testing.T) {
	cases := []struct {
		q, u  string
		milli int64
		unit  string
		ok    bool
	}{
		{"2", "", 2000, UnitCount, true},
		{"1.5 kg", "", 1500, "kg", true},
		{"1.5", "kg", 1500, "kg", true},
		{"1.5kg", "", 1500, "kg", true},
		{"3", "Bottles", 3000, "bottle", true},
		{"1/2", "cup", 500, "cup", true},
		{"2", "litres", 2000, "l", true},
		{"a few", "", 0, "", false},
		{"2", "handfuls", 0, "", false},
		{"2 kg", "lb", 0, "", false},
		{"5000", "", 0, "", false},
		{"", "", 0, "", false},
		{"1/0", "", 0, "", false},
	}
	for _, c := range cases {
		milli, unit, ok := ParseAmount(c.q, c.u)
		if milli != c.milli || unit != c.unit || ok != c.ok {
			t.Errorf("ParseAmount(%q, %q) = %d %q %v, want %d %q %v", c.q, c.u, milli, unit, ok, c.milli, c.unit, c.ok)
		}
	}
	units := AmountUnits()
	for _, u := range []string{"count", "kg", "bottle", "l", "piece"} {
		if !slices.Contains(units, u) {
			t.Errorf("enum misses %q: %v", u, units)
		}
	}
	if slices.Contains(units, "bottles") || slices.Contains(units, "litres") {
		t.Errorf("enum is canonical: %v", units)
	}
}
