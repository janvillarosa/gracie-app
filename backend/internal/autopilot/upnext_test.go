package autopilot_test

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/autopilot"
)

// The same cases run in the frontend (lib/upNext), so the two picks cannot drift.
func TestPickUpNextFixture(t *testing.T) {
	raw, err := os.ReadFile("testdata/upnext_cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name   string                `json:"name"`
		Route  []autopilot.RouteItem `json:"route"`
		Anchor string                `json:"anchor"`
		Next   string                `json:"next"`
		Then   string                `json:"then"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) < 7 {
		t.Fatalf("fixture has %d cases, want at least 7", len(cases))
	}
	for _, c := range cases {
		next, then := autopilot.PickUpNext(c.Route, c.Anchor)
		if next != c.Next || then != c.Then {
			t.Errorf("%s: got (%q, %q), want (%q, %q)", c.Name, next, then, c.Next, c.Then)
		}
	}
}
