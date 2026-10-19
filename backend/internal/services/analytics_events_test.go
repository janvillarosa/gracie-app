package services

import (
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
)

func TestNudgeFollowedIsAClientEvent(t *testing.T) {
	reg := analytics.NewRegistry()
	RegisterAnalyticsEvents(reg)
	ev, err := reg.BuildClient(analytics.ClientEvent{
		EventID: "evt_12345678", Name: "nudge.followed", Subject: analytics.Ref{Type: "nudge", ID: "up_next"},
		Props: map[string]any{"kind": "up_next", "hit": true, "evil": "x"},
	}, "u1", "r1", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if ev.Props["kind"] != "up_next" || ev.Props["hit"] != true || len(ev.Props) != 2 {
		t.Fatalf("props = %v, want kind and hit only", ev.Props)
	}
}
