package households

import (
	"testing"
)

func TestGoldenIsDeterministicAndCoversEveryPersona(t *testing.T) {
	a, b := Golden(), Golden()
	if len(a.Events) != len(b.Events) || len(a.Events) < 2000 {
		t.Fatalf("events: %d vs %d", len(a.Events), len(b.Events))
	}
	for i := range a.Events {
		if a.Events[i].EventID != b.Events[i].EventID || !a.Events[i].OccurredAt.Equal(b.Events[i].OccurredAt) {
			t.Fatalf("event %d differs", i)
		}
	}
	seen := map[string]bool{}
	for _, e := range a.Events {
		if seen[e.EventID] {
			t.Fatalf("duplicate id %s", e.EventID)
		}
		seen[e.EventID] = true
		if !e.OccurredAt.Before(End) {
			t.Fatalf("event after End: %v", e.OccurredAt)
		}
	}
	per := map[string]int{}
	for _, e := range a.Events {
		per[e.RoomID]++
	}
	for _, h := range a.Houses {
		if per[h.Room] == 0 || len(h.Expect) == 0 {
			t.Fatalf("%s: %d events, %d expectations", h.Persona, per[h.Room], len(h.Expect))
		}
	}
	t.Logf("%d events across %d houses: %v", len(a.Events), len(a.Houses), per)
}

func TestPersonasHaveTheirEdgeCases(t *testing.T) {
	w := Golden()
	if len(w.House("weekend-couple").Away()) != 2 {
		t.Fatalf("weekend-couple: the solo trip must not be house away: %v", w.House("weekend-couple").Away())
	}
	ft := w.House("frequent-travellers")
	if len(ft.Left) != 1 || len(ft.Away()) < 12 {
		t.Fatalf("frequent travellers: %v", ft.Away())
	}
	if len(w.House("solo-irregular").Away()) != 0 {
		t.Fatal("solo-irregular never travels")
	}
}
