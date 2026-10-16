package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	api "github.com/janvillarosa/gracie-app/backend/internal/http"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/services"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

type insightsEnv struct {
	r       http.Handler
	m       memstore.Repos
	worker  *analytics.Worker
	nowRef  *time.Time
	members map[string]*models.User
}

func newInsightsEnv(t *testing.T) *insightsEnv {
	t.Helper()
	m := memstore.Compose()
	ctx := context.Background()
	r1, r2 := "room_1", "room_2"
	_ = m.Rooms.Put(ctx, &models.Room{RoomID: r1, MemberIDs: []string{"mia", "sam"}})
	_ = m.Rooms.Put(ctx, &models.Room{RoomID: r2, MemberIDs: []string{"zed"}})
	users := map[string]*models.User{
		"mia": {UserID: "mia", RoomID: &r1}, "sam": {UserID: "sam", RoomID: &r1}, "zed": {UserID: "zed", RoomID: &r2},
	}
	reg := analytics.NewRegistry()
	services.RegisterAnalyticsEvents(reg)
	now := time.Date(2026, 12, 1, 9, 0, 0, 0, time.UTC)
	w := analytics.NewWorker(m.Events, m.Aggs, reg)
	w = w.WithClock(func() time.Time { return now })
	h := NewInsightsHandler(services.NewInsightsService(m.Rooms, analytics.NewReader(m.Aggs)))

	e := &insightsEnv{m: m, worker: w, nowRef: &now, members: users}
	router := chi.NewRouter()
	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if u := users[r.Header.Get("X-Test-User")]; u != nil {
				r = r.WithContext(api.WithUser(r.Context(), u))
			}
			next.ServeHTTP(w, r)
		})
	})
	router.Get("/me/insights", h.Mine)
	router.Get("/rooms/{room_id}/insights", h.House)
	router.Get("/rooms/{room_id}/insights/periods/{period}", h.HousePeriod)
	e.r = router
	return e
}

func (e *insightsEnv) get(user, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("X-Test-User", user)
	w := httptest.NewRecorder()
	e.r.ServeHTTP(w, req)
	return w
}

func (e *insightsEnv) seedWeeklyMilk() {
	for i := 0; i < 4; i++ {
		at := time.Date(2026, 10, 5, 9, 0, 0, 0, time.UTC).AddDate(0, 0, 7*i)
		for _, name := range []string{"item.added", "item.checked"} {
			actor := "mia"
			if name == "item.checked" {
				actor = "sam"
			}
			ev := analytics.Event{
				EventID: name + at.String(), Name: name, Source: analytics.SourceServer, ActorID: actor, RoomID: "room_1",
				Key: "milk", Subject: analytics.Ref{Type: "item", ID: "i1"}, Container: &analytics.Ref{Type: "list", ID: "list_1"}, OccurredAt: at,
			}
			analytics.Stamp(&ev, at.Add(time.Minute), "UTC", 400*24*time.Hour)
			_ = e.m.Events.InsertMany(context.Background(), []analytics.Event{ev})
		}
	}
	if _, err := e.worker.FoldOnce(context.Background()); err != nil {
		panic(err)
	}
	if _, err := e.worker.ProfilePass(context.Background()); err != nil {
		panic(err)
	}
}

func TestInsightsMineIsPersonalAndNullUntilLearned(t *testing.T) {
	e := newInsightsEnv(t)
	w := e.get("mia", "/me/insights")
	if w.Code != http.StatusOK || strings.TrimSpace(w.Body.String()) != `{"profile":null}` {
		t.Fatalf("before any data: %d %s", w.Code, w.Body.String())
	}
	e.seedWeeklyMilk()
	var out struct {
		Profile *struct {
			ID string `json:"id"`
		} `json:"profile"`
	}
	w = e.get("mia", "/me/insights")
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || out.Profile == nil || out.Profile.ID != "u:mia" {
		t.Fatalf("mia: %s", w.Body.String())
	}
	// Sam's own profile is a different document; nobody can ask for someone else's.
	w = e.get("sam", "/me/insights")
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if out.Profile == nil || out.Profile.ID != "u:sam" {
		t.Fatalf("sam: %s", w.Body.String())
	}
}

func TestInsightsHouseListsDueItemsWithoutWhoUsuallyDoesIt(t *testing.T) {
	e := newInsightsEnv(t)
	e.seedWeeklyMilk()
	w := e.get("mia", "/rooms/room_1/insights?within_days=30")
	if w.Code != http.StatusOK {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	var out struct {
		Profile *struct{ ID string } `json:"profile"`
		Due     []map[string]any     `json:"due"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if out.Profile == nil || out.Profile.ID != "h:room_1" || len(out.Due) != 1 || out.Due[0]["key"] != "milk" {
		t.Fatalf("house insights: %s", w.Body.String())
	}
	if _, leaked := out.Due[0]["by_actor"]; leaked {
		t.Fatal("a due item must not say who usually buys it")
	}
	// Nothing is due within a day.
	w = e.get("mia", "/rooms/room_1/insights?within_days=0")
	if !strings.Contains(w.Body.String(), `"due":[]`) {
		t.Fatalf("expected an empty due list: %s", w.Body.String())
	}
}

func TestInsightsPeriodShowsPerMemberTotals(t *testing.T) {
	e := newInsightsEnv(t)
	e.seedWeeklyMilk()
	w := e.get("sam", "/rooms/room_1/insights/periods/2026")
	if w.Code != http.StatusOK {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	var doc map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &doc)
	if _, hasID := doc["_id"]; hasID {
		t.Fatal("storage ids are not part of the response")
	}
	members, _ := doc["members"].(map[string]any)
	mia, _ := members["mia"].(map[string]any)
	sam, _ := members["sam"].(map[string]any)
	if mia == nil || sam == nil {
		t.Fatalf("members: %s", w.Body.String())
	}
	if got := sam["item"].(map[string]any)["checked"]; got != float64(4) {
		t.Fatalf("sam checked %v", got)
	}
	if e.get("sam", "/rooms/room_1/insights/periods/1999").Body.String() == "" {
		t.Fatal("a quiet period is an empty object, not an error")
	}
}

func TestInsightsAreMembersOnlyAndValidated(t *testing.T) {
	e := newInsightsEnv(t)
	e.seedWeeklyMilk()
	for _, path := range []string{"/rooms/room_1/insights", "/rooms/room_1/insights/periods/2026"} {
		if w := e.get("zed", path); w.Code != http.StatusForbidden && w.Code != http.StatusNotFound {
			t.Fatalf("outsider got %d for %s", w.Code, path)
		}
	}
	if w := e.get("", "/me/insights"); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous got %d", w.Code)
	}
	for _, path := range []string{"/rooms/room_1/insights/periods/latest", "/rooms/room_1/insights?subject=Bad%20Subject"} {
		if w := e.get("mia", path); w.Code != http.StatusBadRequest {
			t.Fatalf("%s got %d", path, w.Code)
		}
	}
}
