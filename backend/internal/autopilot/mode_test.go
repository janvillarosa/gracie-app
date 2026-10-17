package autopilot

import "testing"

func TestParseMode(t *testing.T) {
	cases := []struct {
		in   string
		want Mode
		ok   bool
	}{
		{"off", ModeOff, true}, {"suggest", ModeSuggest, true}, {"assist", ModeAssist, true},
		{" Assist ", ModeAssist, true}, {"SUGGEST", ModeSuggest, true},
		{"", "", false}, {"auto", "", false}, {"on", "", false},
	}
	for _, c := range cases {
		got, ok := ParseMode(c.in)
		if got != c.want || ok != c.ok {
			t.Errorf("ParseMode(%q) = %q,%v want %q,%v", c.in, got, ok, c.want, c.ok)
		}
	}
}

func TestHouseMode(t *testing.T) {
	cases := []struct {
		stored string
		legacy bool
		want   Mode
	}{
		{"", false, ModeSuggest}, {"", true, ModeOff}, {"assist", true, ModeAssist},
		{"off", false, ModeOff}, {"junk", false, ModeSuggest},
	}
	for _, c := range cases {
		if got := HouseMode(c.stored, c.legacy); got != c.want {
			t.Errorf("HouseMode(%q, %v) = %s, want %s", c.stored, c.legacy, got, c.want)
		}
	}
}
