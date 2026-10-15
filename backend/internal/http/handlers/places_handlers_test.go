package handlers_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	handlers "github.com/janvillarosa/gracie-app/backend/internal/http/handlers"
	"github.com/janvillarosa/gracie-app/backend/internal/http/router"
	"github.com/janvillarosa/gracie-app/backend/internal/ratelimit"
	"github.com/janvillarosa/gracie-app/backend/internal/services"
	"github.com/janvillarosa/gracie-app/backend/internal/services/categorization"
	"github.com/janvillarosa/gracie-app/backend/internal/services/places"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

func TestPlacesSearchDegradesWithoutGeocoderAndValidates(t *testing.T) {
	f := newPlacesFixture(t) // builds the router with a nil-geocoder places service; see newTripFixture for the pattern
	get := func(path string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+f.apiKey)
		rec := httptest.NewRecorder()
		f.h.ServeHTTP(rec, req)
		return rec
	}
	rec := get("/places/search?q=kyoto+station")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"degraded":true`) || !strings.Contains(rec.Body.String(), `"results":[]`) {
		t.Fatalf("no geocoder must degrade, got %d %s", rec.Code, rec.Body)
	}
	if rec := get("/places/search?q=ab"); rec.Code != http.StatusBadRequest {
		t.Fatalf("short query: %d", rec.Code)
	}
	if rec := get("/places/search?q=kyoto&lat=abc"); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad lat: %d", rec.Code)
	}
	if rec := get("/places/reverse?lat=35"); rec.Code != http.StatusBadRequest {
		t.Fatalf("missing lng: %d", rec.Code)
	}
	req := httptest.NewRequest(http.MethodGet, "/places/search?q=kyoto", nil)
	rec = httptest.NewRecorder()
	f.h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("auth required: %d", rec.Code)
	}
}

func newPlacesFixture(t *testing.T) tripFixture {
	t.Helper()
	m := memstore.Compose()
	userSvc := services.NewUserService(m.Users, m.Rooms, m.Tx)
	roomSvc := services.NewRoomService(m.Users, m.Rooms, m.Tx)
	listSvc := services.NewListService(m.Users, m.Rooms, m.Lists, m.Items, categorization.NewKeywordCategorizer(categorization.GroceryAnchors))
	authSvc, err := services.NewAuthService(m.Users, "/tmp/gracie-test-enc.key", 720)
	if err != nil {
		t.Fatal(err)
	}
	placesSvc := places.NewService(nil, nil, m.Places, ratelimit.New(1000, 1000)) // nil geocoder => always degraded
	h := router.NewRouter(m.Users, router.Handlers{
		Auth: handlers.NewAuthHandler(authSvc), User: handlers.NewUserHandler(userSvc, []byte("salt")),
		Room: handlers.NewRoomHandler(roomSvc, m.Users, []byte("salt")), List: handlers.NewListHandler(listSvc),
		Places: handlers.NewPlacesHandler(placesSvc, ratelimit.New(1000, 1000)),
	})
	cu, err := userSvc.CreateUserWithSoloRoom(context.Background(), "A")
	if err != nil {
		t.Fatal(err)
	}
	return tripFixture{h: h, apiKey: cu.APIKey, roomID: *cu.User.RoomID}
}
