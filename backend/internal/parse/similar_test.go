package parse

import (
	"math"
	"testing"
)

func TestCompactFoldsPluralsSpacesAndHyphens(t *testing.T) {
	cases := map[string]string{
		"oranges":       "orange",
		"orange":        "orange",
		"butter beans":  "butterbean",
		"butterbeans":   "butterbean",
		"berries":       "berry",
		"tomatoes":      "tomato",
		"peaches":       "peach",
		"boxes":         "box",
		"glasses":       "glass",
		"cheeses":       "cheese",
		"hummus":        "hummus",
		"swiss":         "swiss",
		"half-and-half": "halfandhalf",
		"eggs":          "egg",
	}
	for in, want := range cases {
		if got := CompactKey(in); got != want {
			t.Errorf("CompactKey(%q) = %q want %q", in, got, want)
		}
	}
}

func TestSimilarity(t *testing.T) {
	cases := []struct {
		a, b string
		min  float64 // inclusive
		max  float64 // inclusive
	}{
		{"orange", "oranges", 1, 1},
		{"butterbeans", "butter beans", 1, 1},
		{"strawberries", "strawberry", 1, 1},
		{"yogurt", "yoghurt", 0.85, 0.99},    // a spelling apart: similar, but not certain
		{"almond milk", "oat milk", 0, 0.84}, // different things
		{"milk", "silk", 0, 0.84},            // short words need more than one letter in common
		{"tea", "pea", 0, 0},                 // under four letters: exact or nothing
		{"rice", "rice", 1, 1},
	}
	for _, c := range cases {
		got := Similarity(c.a, c.b)
		if got < c.min || got > c.max || math.IsNaN(got) {
			t.Errorf("Similarity(%q, %q) = %.3f want [%.2f, %.2f]", c.a, c.b, got, c.min, c.max)
		}
		if Similarity(c.b, c.a) != got {
			t.Errorf("not symmetric for %q / %q", c.a, c.b)
		}
	}
	if !Similar("orange", "oranges") || Similar("milk", "silk") {
		t.Fatal("Similar should apply the threshold")
	}
}
