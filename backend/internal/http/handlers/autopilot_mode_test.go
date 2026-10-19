package handlers_test

import (
	"encoding/json"
	"net/http"
	"slices"
	"testing"
)

type modeView struct {
	AutopilotMode  string `json:"autopilot_mode"`
	SuggestionsOff bool   `json:"suggestions_off"`
}

func (f tripFixture) modeOf(t *testing.T) modeView {
	t.Helper()
	rec := f.do(http.MethodGet, "/rooms/me", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /rooms/me: %d %s", rec.Code, rec.Body)
	}
	var v modeView
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestAutopilotModeSetting(t *testing.T) {
	f := newTripFixture(t, nil, nil)
	if got := f.modeOf(t); got.AutopilotMode != "suggest" || got.SuggestionsOff {
		t.Fatalf("default: %+v", got)
	}
	if rec := f.do(http.MethodPut, "/rooms/settings", `{"autopilot_mode":"bogus"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown mode: %d %s", rec.Code, rec.Body)
	}
	rec := f.do(http.MethodPut, "/rooms/settings", `{"autopilot_mode":"Assist"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("set assist: %d %s", rec.Code, rec.Body)
	}
	var put modeView
	_ = json.Unmarshal(rec.Body.Bytes(), &put)
	if put.AutopilotMode != "assist" {
		t.Fatalf("PUT view: %s", rec.Body)
	}
	if got := f.modeOf(t); got.AutopilotMode != "assist" || got.SuggestionsOff {
		t.Fatalf("after assist: %+v", got)
	}
	// The pre-mode switch still works for one release, and maps onto the mode.
	if rec := f.do(http.MethodPut, "/rooms/settings", `{"suggestions_off":true}`); rec.Code != http.StatusOK {
		t.Fatalf("suggestions_off: %d", rec.Code)
	}
	if got := f.modeOf(t); got.AutopilotMode != "off" || !got.SuggestionsOff {
		t.Fatalf("legacy off: %+v", got)
	}
	if rec := f.do(http.MethodPut, "/rooms/settings", `{"suggestions_off":false}`); rec.Code != http.StatusOK {
		t.Fatalf("suggestions on: %d", rec.Code)
	}
	if got := f.modeOf(t); got.AutopilotMode != "suggest" {
		t.Fatalf("legacy on: %+v", got)
	}
	// Turning the old switch "on" never downgrades an assist house.
	f.do(http.MethodPut, "/rooms/settings", `{"autopilot_mode":"assist"}`)
	f.do(http.MethodPut, "/rooms/settings", `{"suggestions_off":false}`)
	if got := f.modeOf(t); got.AutopilotMode != "assist" {
		t.Fatalf("assist kept: %+v", got)
	}
}

func TestAutopilotFeaturesOnRoomPayload(t *testing.T) {
	f := newTripFixture(t, nil, nil)
	features := func() []string {
		rec := f.do(http.MethodGet, "/rooms/me", "")
		var v struct {
			Features []string `json:"autopilot_features"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
			t.Fatal(err)
		}
		if v.Features == nil {
			t.Fatalf("autopilot_features missing: %s", rec.Body)
		}
		return v.Features
	}
	if got := features(); !slices.Equal(got, []string{"run_hint", "suggestions", "up_next"}) {
		t.Fatalf("suggest: %v", got)
	}
	if rec := f.do(http.MethodPut, "/rooms/settings", `{"autopilot_mode":"off"}`); rec.Code != http.StatusOK {
		t.Fatalf("set off: %d", rec.Code)
	}
	if got := features(); len(got) != 0 {
		t.Fatalf("off: %v", got)
	}
}
