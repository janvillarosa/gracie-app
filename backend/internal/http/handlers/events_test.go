package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	api "github.com/janvillarosa/gracie-app/backend/internal/http"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/ratelimit"
	"github.com/janvillarosa/gracie-app/backend/internal/services"
	"github.com/janvillarosa/gracie-app/backend/internal/trips"
)

func newEventsHandler(rps float64) (*EventsHandler, *analytics.MemRecorder) {
	reg := analytics.NewRegistry()
	services.RegisterAnalyticsEvents(reg)
	trips.RegisterAnalyticsEvents(reg)
	rec := analytics.NewMemRecorder(reg)
	return NewEventsHandler(rec, reg, ratelimit.New(rps, ratelimit.Burst(rps))), rec
}

func postEvents(h *EventsHandler, body string) *httptest.ResponseRecorder {
	room := "room_1"
	req := httptest.NewRequest(http.MethodPost, "/events", strings.NewReader(body))
	req = req.WithContext(api.WithUser(req.Context(), &models.User{UserID: "user_1", RoomID: &room}))
	w := httptest.NewRecorder()
	h.Ingest(w, req)
	return w
}

func TestEventsIngestStampsIdentityFromAuth(t *testing.T) {
	h, rec := newEventsHandler(50)
	w := postEvents(h, `{"events":[
		{"event_id":"evt_00000001","name":"list.view","subject":{"type":"list","id":"list_1"}},
		{"event_id":"evt_00000002","name":"add_bar.suggestion_accepted","subject":{"type":"add_bar","id":"list_1"},"key":"  Whole   MILK ","props":{"rank":1,"evil":"x"}},
		{"event_id":"evt_00000003","name":"item.added","subject":{"type":"item","id":"i1"}},
		{"event_id":"evt_00000004","name":"nope.nope","subject":{"type":"nope","id":"x"}}
	]}`)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"accepted":2`) || !strings.Contains(w.Body.String(), `"rejected":2`) {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	evs := rec.Events()
	if len(evs) != 2 {
		t.Fatalf("recorded %d", len(evs))
	}
	for _, e := range evs {
		if e.ActorID != "user_1" || e.RoomID != "room_1" || e.Source != analytics.SourceClient {
			t.Fatalf("identity must come from auth: %+v", e)
		}
	}
	if evs[1].Key != "whole milk" || len(evs[1].Props) != 1 {
		t.Fatalf("suggestion event: %+v", evs[1])
	}
}

func TestEventsIngestRejectsBadBatches(t *testing.T) {
	h, _ := newEventsHandler(50)
	for name, body := range map[string]string{
		"empty":         `{"events":[]}`,
		"unknown field": `{"events":[{"event_id":"evt_00000001","name":"list.view","subject":{"type":"list","id":"l"},"actor_id":"someone-else"}]}`,
		"not json":      `nope`,
	} {
		if w := postEvents(h, body); w.Code != http.StatusBadRequest {
			t.Errorf("%s: got %d", name, w.Code)
		}
	}
	big := `{"events":[` + strings.Repeat(`{"event_id":"evt_00000001","name":"list.view","subject":{"type":"list","id":"l"}},`, 51) + `{"event_id":"evt_00000001","name":"list.view","subject":{"type":"list","id":"l"}}]}`
	if w := postEvents(h, big); w.Code != http.StatusBadRequest && w.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("oversized batch: got %d", w.Code)
	}
}

func TestEventsIngestIsRateLimitedPerUser(t *testing.T) {
	h, _ := newEventsHandler(1) // burst 4
	body := `{"events":[{"event_id":"evt_00000001","name":"list.view","subject":{"type":"list","id":"l"}}]}`
	limited := false
	for i := 0; i < 10; i++ {
		if postEvents(h, body).Code == http.StatusTooManyRequests {
			limited = true
		}
	}
	if !limited {
		t.Fatal("expected a 429 after the burst")
	}
}
