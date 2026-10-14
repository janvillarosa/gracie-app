package handlers_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	handlers "github.com/janvillarosa/gracie-app/backend/internal/http/handlers"
	"github.com/janvillarosa/gracie-app/backend/internal/http/router"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/ratelimit"
	"github.com/janvillarosa/gracie-app/backend/internal/services"
	"github.com/janvillarosa/gracie-app/backend/internal/services/categorization"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

type tripFixture struct {
	h      http.Handler
	apiKey string
	roomID string
}

func newTripFixture(t *testing.T, tripRepo store.TripRepository, rl *ratelimit.Limiter) tripFixture {
	t.Helper()
	m := memstore.Compose()
	if tripRepo == nil {
		tripRepo = m.Trips
	}
	userSvc := services.NewUserService(m.Users, m.Rooms, m.Tx)
	roomSvc := services.NewRoomService(m.Users, m.Rooms, m.Tx)
	listSvc := services.NewListService(m.Users, m.Rooms, m.Lists, m.Items, categorization.NewKeywordCategorizer(categorization.GroceryAnchors))
	tripSvc := services.NewTripService(m.Rooms, tripRepo, listSvc, m.Lists)
	authSvc, err := services.NewAuthService(m.Users, "/tmp/gracie-test-enc.key", 720)
	if err != nil {
		t.Fatal(err)
	}
	if rl == nil {
		rl = ratelimit.New(1000, 1000)
	}
	h := router.NewRouter(m.Users, router.Handlers{
		Auth: handlers.NewAuthHandler(authSvc), User: handlers.NewUserHandler(userSvc, []byte("salt")),
		Room: handlers.NewRoomHandler(roomSvc, m.Users, []byte("salt")), List: handlers.NewListHandler(listSvc),
		Trip: handlers.NewTripHandler(tripSvc, rl),
	})
	cu, err := userSvc.CreateUserWithSoloRoom(context.Background(), "A")
	if err != nil {
		t.Fatal(err)
	}
	return tripFixture{h: h, apiKey: cu.APIKey, roomID: *cu.User.RoomID}
}

func (f tripFixture) post(path string, body any, headers map[string]string) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	switch b := body.(type) {
	case string:
		buf.WriteString(b)
	default:
		_ = json.NewEncoder(&buf).Encode(b)
	}
	req := httptest.NewRequest(http.MethodPost, path, &buf)
	req.Header.Set("Authorization", "Bearer "+f.apiKey)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	f.h.ServeHTTP(rec, req)
	return rec
}

var hTripID = "trip_" + strings.Repeat("c", 32)

func hOp(seq int, typ, entity string, patch map[string]any) map[string]any {
	m := map[string]any{"v": 1, "op_id": "op-" + string(rune('a'+seq)), "client_id": "dev-h", "seq": seq,
		"at": time.Now().UnixMilli() - 500, "type": typ, "trip_id": hTripID}
	if entity != "" {
		m["entity_id"] = entity
	}
	if patch != nil {
		m["patch"] = patch
	}
	return m
}

func TestTripOpsAndSyncOverHTTP(t *testing.T) {
	f := newTripFixture(t, nil, nil)
	body := map[string]any{"ops": []any{
		hOp(1, "trip.create", "", map[string]any{"title": "Japan"}),
		hOp(2, "todo.create", "ttd_"+strings.Repeat("1", 32), map[string]any{"title": "Ramen"}),
		map[string]any{"op_id": "op-bad", "v": 1, "nonsense": true},
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
	if len(resp.Results) != 3 || resp.Results[0].Status != "applied" || resp.Results[2].Code != "unsupported" || len(resp.Trips) != 1 {
		t.Fatalf("per-op results must be independent: %+v", resp)
	}

	rec = f.post("/rooms/"+f.roomID+"/trips/sync", map[string]any{"known": map[string]int64{}}, nil)
	var sync struct {
		Trips []models.TripDelta `json:"trips"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &sync)
	if rec.Code != http.StatusOK || len(sync.Trips) != 1 || !sync.Trips[0].Full {
		t.Fatalf("sync: %d %s", rec.Code, rec.Body)
	}
}

func TestTripEndpointsRequireAuthAndMembership(t *testing.T) {
	f := newTripFixture(t, nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/rooms/"+f.roomID+"/trips/sync", strings.NewReader(`{"known":{}}`))
	rec := httptest.NewRecorder()
	f.h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no auth: %d", rec.Code)
	}
	if rec := f.post("/rooms/room_someone_else/trips/sync", map[string]any{"known": map[string]int64{}}, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("wrong room: %d", rec.Code)
	}
}

func TestTripBodyLimits(t *testing.T) {
	f := newTripFixture(t, nil, nil)
	big := `{"known":{},"pad":"` + strings.Repeat("x", 70*1024) + `"}`
	if rec := f.post("/rooms/"+f.roomID+"/trips/sync", big, nil); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("sync body over 64KB: want 413, got %d", rec.Code)
	}
	huge := `{"ops":[],"pad":"` + strings.Repeat("x", (1<<20)+10) + `"}`
	if rec := f.post("/rooms/"+f.roomID+"/trips/ops", huge, nil); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("ops body over 1MB: want 413, got %d", rec.Code)
	}
	if rec := f.post("/rooms/"+f.roomID+"/trips/ops", `{"ops":[]}`, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("empty batch: want 400, got %d", rec.Code)
	}
	if rec := f.post("/rooms/"+f.roomID+"/trips/ops", `not json`, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("malformed: want 400, got %d", rec.Code)
	}
}

func TestTripResponsesAreGzipped(t *testing.T) {
	f := newTripFixture(t, nil, nil)
	rec := f.post("/rooms/"+f.roomID+"/trips/sync", map[string]any{"known": map[string]int64{}}, map[string]string{"Accept-Encoding": "gzip"})
	if rec.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("expected gzip, headers=%v", rec.Header())
	}
	zr, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(zr)
	if !strings.Contains(string(b), `"trips"`) {
		t.Fatalf("body: %s", b)
	}
}

type failingTrips struct{ store.TripRepository }

func (failingTrips) Manifest(context.Context, string) ([]store.TripStub, error) {
	return nil, errors.New("mongo exploded")
}

func TestUnknownErrorsMapTo500NotBadRequest(t *testing.T) {
	m := memstore.Compose()
	f := newTripFixture(t, failingTrips{m.Trips}, nil)
	rec := f.post("/rooms/"+f.roomID+"/trips/sync", map[string]any{"known": map[string]int64{}}, nil)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d %s", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), "mongo exploded") {
		t.Fatalf("internal error text must not leak: %s", rec.Body)
	}
}

func TestTripRateLimit(t *testing.T) {
	f := newTripFixture(t, nil, ratelimit.New(0.0001, 2))
	for i := 0; i < 2; i++ {
		if rec := f.post("/rooms/"+f.roomID+"/trips/sync", map[string]any{"known": map[string]int64{}}, nil); rec.Code != http.StatusOK {
			t.Fatalf("call %d: %d", i, rec.Code)
		}
	}
	if rec := f.post("/rooms/"+f.roomID+"/trips/sync", map[string]any{"known": map[string]int64{}}, nil); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("want 429, got %d", rec.Code)
	}
}

func TestPackingListEndpoint(t *testing.T) {
	f := newTripFixture(t, nil, nil)
	f.post("/rooms/"+f.roomID+"/trips/ops", map[string]any{"ops": []any{hOp(1, "trip.create", "", map[string]any{"title": "Japan"})}}, nil)
	rec := f.post("/rooms/"+f.roomID+"/trips/"+hTripID+"/packing-list", `{}`, nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Packing") {
		t.Fatalf("packing: %d %s", rec.Code, rec.Body)
	}
	rec = f.post("/rooms/"+f.roomID+"/trips/trip_"+strings.Repeat("0", 32)+"/packing-list", `{}`, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown trip: %d", rec.Code)
	}
}
