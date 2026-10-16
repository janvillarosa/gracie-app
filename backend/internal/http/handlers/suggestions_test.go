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

func newSuggestionsRouter(t *testing.T) (http.Handler, memstore.Repos) {
	t.Helper()
	m := memstore.Compose()
	ctx := context.Background()
	room, other := "room_1", "room_2"
	_ = m.Rooms.Put(ctx, &models.Room{RoomID: room, MemberIDs: []string{"mia"}})
	_ = m.Rooms.Put(ctx, &models.Room{RoomID: other, MemberIDs: []string{"zed"}})
	_ = m.Lists.Put(ctx, &models.List{ListID: "list_1", RoomID: room, Name: "Groceries"})
	users := map[string]*models.User{"mia": {UserID: "mia", RoomID: &room}, "zed": {UserID: "zed", RoomID: &other}}

	svc := services.NewSuggestionService(m.Rooms, m.Lists, m.Items, analytics.NewReader(m.Aggs), m.Events, services.SuggestionsOn)
	h := NewSuggestionsHandler(svc)
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if u := users[req.Header.Get("X-Test-User")]; u != nil {
				req = req.WithContext(api.WithUser(req.Context(), u))
			}
			next.ServeHTTP(w, req)
		})
	})
	r.Get("/rooms/{room_id}/lists/{list_id}/suggestions", h.ForList)
	r.Post("/rooms/{room_id}/lists/{list_id}/suggestions/ignore", h.Ignore)
	return r, m
}

func call(r http.Handler, user, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("X-Test-User", user)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestSuggestionsRequireAMemberOfTheHouse(t *testing.T) {
	r, _ := newSuggestionsRouter(t)
	base := "/rooms/room_1/lists/list_1/suggestions"
	if w := call(r, "", http.MethodGet, base, ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous: %d", w.Code)
	}
	if w := call(r, "zed", http.MethodGet, base, ""); w.Code != http.StatusForbidden {
		t.Fatalf("other house: %d", w.Code)
	}
	if w := call(r, "zed", http.MethodPost, base+"/ignore", `{"key":"milk"}`); w.Code != http.StatusForbidden {
		t.Fatalf("other house ignore: %d", w.Code)
	}
}

func TestSuggestionsAreAnEmptyListWhenNothingIsDue(t *testing.T) {
	r, _ := newSuggestionsRouter(t)
	w := call(r, "mia", http.MethodGet, "/rooms/room_1/lists/list_1/suggestions", "")
	var body struct {
		Suggestions []services.Suggestion `json:"suggestions"`
	}
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &body) != nil || body.Suggestions == nil || len(body.Suggestions) != 0 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
}

func TestIgnoreValidatesTheBody(t *testing.T) {
	r, _ := newSuggestionsRouter(t)
	p := "/rooms/room_1/lists/list_1/suggestions/ignore"
	if w := call(r, "mia", http.MethodPost, p, `not json`); w.Code != http.StatusBadRequest {
		t.Fatalf("bad json: %d", w.Code)
	}
	if w := call(r, "mia", http.MethodPost, p, `{"key":""}`); w.Code != http.StatusBadRequest {
		t.Fatalf("empty key: %d", w.Code)
	}
	if w := call(r, "mia", http.MethodPost, p, `{"key":"`+strings.Repeat("x", 200)+`"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("long key: %d", w.Code)
	}
	if w := call(r, "mia", http.MethodPost, p, `{"key":"never seen"}`); w.Code != http.StatusNotFound {
		t.Fatalf("unknown key: %d", w.Code)
	}
}

func TestIgnoreAcceptsAKnownKey(t *testing.T) {
	r, m := newSuggestionsRouter(t)
	at := time.Now().UTC()
	e := analytics.Event{EventID: "e1", Name: "item.added", RoomID: "room_1", Key: "2% milk", OccurredAt: at,
		Subject: analytics.Ref{Type: "item", ID: "i"}, Container: &analytics.Ref{Type: "list", ID: "list_1"}}
	analytics.Stamp(&e, at, "UTC", time.Hour)
	_ = m.Events.InsertMany(context.Background(), []analytics.Event{e})
	reg := analytics.NewRegistry()
	services.RegisterAnalyticsEvents(reg)
	if _, err := analytics.NewWorker(m.Events, m.Aggs, reg).WithClock(func() time.Time { return at.Add(time.Hour) }).FoldOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if w := call(r, "mia", http.MethodPost, "/rooms/room_1/lists/list_1/suggestions/ignore", `{"key":"2% milk"}`); w.Code != http.StatusNoContent {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
}
