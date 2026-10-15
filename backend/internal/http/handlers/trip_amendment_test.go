package handlers_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func TestTripAmendmentFieldsOverHTTP(t *testing.T) {
	f := newTripFixture(t, nil, nil)
	todo := "ttd_" + strings.Repeat("2", 32)
	body := map[string]any{"ops": []any{
		hOp(1, "trip.create", "", map[string]any{"title": "Portugal"}),
		hOp(2, "trip.update", "", map[string]any{
			"days":  map[string]string{"2026-10-24": "Sintra"},
			"stops": []map[string]any{{"name": "Lisbon", "locality": "Lisbon", "lat": 38.7, "lng": -9.1, "source": "manual"}},
		}),
		hOp(3, "todo.create", todo, map[string]any{"title": "Palace"}),
		hOp(4, "todo.update", todo, map[string]any{"created_by": "someone-else"}),
	}}
	rec := f.post("/rooms/"+f.roomID+"/trips/ops", body, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("ops: %d %s", rec.Code, rec.Body)
	}
	var resp struct {
		Results []models.OpResult  `json:"results"`
		Trips   []models.TripDelta `json:"trips"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Results) != 4 || resp.Results[3].Status != "rejected" || resp.Results[3].Code != "unsupported" {
		t.Fatalf("created_by must not be patchable: %+v", resp.Results)
	}
	d := resp.Trips[0]
	if d.Trip == nil || d.Trip.Days["2026-10-24"] != "Sintra" || len(d.Trip.Stops) != 1 || d.Trip.Stops[0].Locality != "Lisbon" {
		t.Fatalf("days/stops missing from delta: %+v", d.Trip)
	}
	if len(d.Todos) != 1 || d.Todos[0].CreatedBy == "" || d.Todos[0].CreatedBy != d.Todos[0].UpdatedBy {
		t.Fatalf("created_by/updated_by must be server-set: %+v", d.Todos)
	}
	for _, key := range []string{`"created_by"`, `"updated_by"`, `"days"`, `"stops"`, `"locality"`} {
		if !strings.Contains(rec.Body.String(), key) {
			t.Fatalf("response lacks %s: %s", key, rec.Body)
		}
	}
}
