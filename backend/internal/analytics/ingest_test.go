package analytics

import (
	"errors"
	"testing"
	"time"
)

func clientReg() *Registry {
	r := NewRegistry()
	r.MustRegister(
		EventDef{Name: "list.view", Client: true},
		EventDef{Name: "nudge.shown", Client: true, Props: map[string]PropSpec{"kind": {Kind: PropString, MaxLen: 16}}},
		EventDef{Name: "item.added"}, // server only
	)
	return r
}

func TestBuildClientAcceptsAndSanitizes(t *testing.T) {
	now := time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)
	ev, err := clientReg().BuildClient(ClientEvent{
		EventID: "evt_12345678", Name: "nudge.shown", Subject: Ref{"nudge", "n1"},
		Props: map[string]any{"kind": "run", "evil": "x"}, OccurredAt: now.Add(-time.Hour).UnixMilli(),
	}, "u1", "r1", now)
	if err != nil {
		t.Fatal(err)
	}
	if ev.ActorID != "u1" || ev.RoomID != "r1" || ev.Source != SourceClient || len(ev.Props) != 1 ||
		!ev.OccurredAt.Equal(now.Add(-time.Hour)) {
		t.Fatalf("got %+v", ev)
	}
}

func TestBuildClientRejects(t *testing.T) {
	now := time.Now()
	good := ClientEvent{EventID: "evt_12345678", Name: "list.view", Subject: Ref{"list", "l1"}}
	cases := map[string]struct {
		mut  func(*ClientEvent)
		want error
	}{
		"server-only event": {func(c *ClientEvent) { c.Name = "item.added"; c.Subject.Type = "item" }, ErrNotClientEvent},
		"unknown event":     {func(c *ClientEvent) { c.Name = "nope.thing" }, ErrNotClientEvent},
		"subject mismatch":  {func(c *ClientEvent) { c.Subject.Type = "trip" }, ErrInvalidEvent},
		"short event id":    {func(c *ClientEvent) { c.EventID = "x" }, ErrInvalidEvent},
		"bad subject id":    {func(c *ClientEvent) { c.Subject.ID = "a b/c" }, ErrInvalidEvent},
		"oversized key":     {func(c *ClientEvent) { c.Key = string(make([]byte, 200)) }, ErrInvalidEvent},
		"bad container":     {func(c *ClientEvent) { c.Container = &Ref{"", ""} }, ErrInvalidEvent},
		"bad session id":    {func(c *ClientEvent) { c.SessionID = "has space" }, ErrInvalidEvent},
	}
	for name, tc := range cases {
		ce := good
		tc.mut(&ce)
		if _, err := clientReg().BuildClient(ce, "u", "r", now); !errors.Is(err, tc.want) {
			t.Errorf("%s: got %v want %v", name, err, tc.want)
		}
	}
}

func TestBuildClientClampsTime(t *testing.T) {
	now := time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)
	mk := func(at time.Time) time.Time {
		ev, err := clientReg().BuildClient(ClientEvent{EventID: "evt_12345678", Name: "list.view", Subject: Ref{"list", "l"}, OccurredAt: at.UnixMilli()}, "u", "r", now)
		if err != nil {
			t.Fatal(err)
		}
		return ev.OccurredAt
	}
	if got := mk(now.Add(48 * time.Hour)); !got.Equal(now) {
		t.Errorf("future clamps to now, got %v", got)
	}
	if got := mk(now.AddDate(0, -3, 0)); !got.Equal(now.Add(-maxBackdate)) {
		t.Errorf("old clamps to 7d, got %v", got)
	}
	if got := mk(now.Add(-time.Hour)); !got.Equal(now.Add(-time.Hour)) {
		t.Errorf("in-range kept, got %v", got)
	}
}
