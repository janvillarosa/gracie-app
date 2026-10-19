package handlers_test

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/http/handlers"
	"github.com/janvillarosa/gracie-app/backend/internal/http/router"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/ratelimit"
	"github.com/janvillarosa/gracie-app/backend/internal/services"
	"github.com/janvillarosa/gracie-app/backend/internal/services/categorization"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

func newTestModeFixture(t *testing.T, tester bool, burst int) (pushFixture, string) {
	// Returns the fixture and the tester's room id.
	t.Helper()
	m := memstore.Compose()
	userSvc := services.NewUserService(m.Users, m.Rooms, m.Tx)
	roomSvc := services.NewRoomService(m.Users, m.Rooms, m.Tx)
	listSvc := services.NewListService(m.Users, m.Rooms, m.Lists, m.Items, categorization.NewKeywordCategorizer(categorization.GroceryAnchors))
	authSvc, err := services.NewAuthService(m.Users, "/tmp/gracie-test-enc.key", 720)
	if err != nil {
		t.Fatal(err)
	}
	notify := services.NewNotifyService(m.Users, m.Rooms, m.Lists, m.Push, m.Push, nopSender{}, "k", []byte("0123456789abcdef0123456789abcdef"))
	tm := services.NewTestModeService(m.Users, m.Rooms)
	tm.UseNotify(notify)
	hs := router.Handlers{
		Auth: handlers.NewAuthHandler(authSvc), User: handlers.NewUserHandler(userSvc, []byte("salt")),
		Room: handlers.NewRoomHandler(roomSvc, m.Users, []byte("salt")), List: handlers.NewListHandler(listSvc),
		TestMode: handlers.NewTestModeHandler(tm, ratelimit.New(1, burst)),
	}
	cu, err := userSvc.CreateUserWithSoloRoom(context.Background(), "A")
	if err != nil {
		t.Fatal(err)
	}
	if tester {
		if err := m.Users.SetTestAccount(context.Background(), cu.User.UserID, true, cu.User.UpdatedAt); err != nil {
			t.Fatal(err)
		}
	}
	return pushFixture{h: router.NewRouter(m.Users, hs), apiKey: cu.APIKey, m: m}, *cu.User.RoomID
}

func TestTestModeRoutesAreInvisibleToNormalAccounts(t *testing.T) {
	f, _ := newTestModeFixture(t, false, 5)
	if rec := f.do(http.MethodGet, "/test/actions", "", f.apiKey); rec.Code != http.StatusNotFound {
		t.Fatalf("list: %d %s", rec.Code, rec.Body)
	}
	if rec := f.do(http.MethodPost, "/test/actions/push.test", "", f.apiKey); rec.Code != http.StatusNotFound {
		t.Fatalf("run: %d %s", rec.Code, rec.Body)
	}
	if rec := f.do(http.MethodGet, "/test/actions", "", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("no auth: %d", rec.Code)
	}
}

func TestTestModeMeFlagListAndRun(t *testing.T) {
	f, _ := newTestModeFixture(t, true, 5)
	rec := f.do(http.MethodGet, "/me", "", f.apiKey)
	if rec.Code != http.StatusOK || !contains(rec.Body.String(), `"test_account":true`) {
		t.Fatalf("/me: %d %s", rec.Code, rec.Body)
	}
	rec = f.do(http.MethodGet, "/test/actions", "", f.apiKey)
	if rec.Code != http.StatusOK || !contains(rec.Body.String(), `"id":"push.test"`) || !contains(rec.Body.String(), `"touches_house":true`) {
		t.Fatalf("list: %d %s", rec.Code, rec.Body)
	}
	rec = f.do(http.MethodPost, "/test/actions/push.test", "", f.apiKey)
	if rec.Code != http.StatusOK || !contains(rec.Body.String(), `"message":"You have no devices yet`) {
		t.Fatalf("run: %d %s", rec.Code, rec.Body)
	}
	if rec := f.do(http.MethodPost, "/test/actions/nope", "", f.apiKey); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown: %d", rec.Code)
	}
}

func TestTestModeRefusesRealHousematesAndRateLimits(t *testing.T) {
	f, roomID := newTestModeFixture(t, true, 3)
	ctx := context.Background()
	// A real person joins the tester's house.
	real := &models.User{UserID: "u_real", Name: "Real"}
	_ = f.m.Users.Put(ctx, real)
	_ = f.m.Rooms.AddMember(ctx, roomID, real.UserID, real.UpdatedAt)
	rec := f.do(http.MethodPost, "/test/actions/push.burst", "", f.apiKey)
	if rec.Code != http.StatusConflict || !contains(rec.Body.String(), "not every member of your house is a test account") {
		t.Fatalf("burst: %d %s", rec.Code, rec.Body)
	}
	// The limiter allows a burst of 3 runs, then says wait.
	var last int
	for range 4 {
		last = f.do(http.MethodPost, "/test/actions/push.test", "", f.apiKey).Code
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("not rate limited: %d", last)
	}
}

func contains(s, sub string) bool { return strings.Contains(s, sub) }
