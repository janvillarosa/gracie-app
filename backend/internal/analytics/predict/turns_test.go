package predict

import "testing"

func TestNextTurn(t *testing.T) {
	ab := []string{"A", "B"}
	cases := []struct {
		name    string
		turns   []string // newest first
		members []string
		want    string
	}{
		{"strict alternation: A,B,A,B -> A after B", []string{"B", "A", "B", "A"}, ab, "A"},
		{"fewest completions: A,A,A,B -> B", []string{"B", "A", "A", "A"}, ab, "B"},
		{"one member is nobody's turn", []string{"A", "A", "A", "A"}, []string{"A"}, ""},
		{"no history", nil, ab, ""},
		{"a member who left is never returned", []string{"C", "A", "C", "A"}, ab, "B"},
		{"system actors are ignored", []string{"system:autopilot", "B", "A", "B", "A"}, ab, "A"},
		{"ties go to whoever did it longest ago", []string{"A", "B"}, ab, "B"},
		{"two of three alternate: they keep it", []string{"A", "B", "A", "B"}, []string{"A", "B", "C"}, "B"},
		{"three people, one never did it", []string{"A", "A", "B", "A"}, []string{"A", "B", "C"}, "C"},
	}
	for _, c := range cases {
		if got := NextTurn(c.turns, c.members); got != c.want {
			t.Errorf("%s: got %q want %q", c.name, got, c.want)
		}
	}
}
