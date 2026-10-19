package handlers_test

import (
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/http/handlers"
	"github.com/janvillarosa/gracie-app/backend/internal/http/router"
	"github.com/janvillarosa/gracie-app/backend/internal/services"
	"github.com/janvillarosa/gracie-app/backend/internal/services/categorization"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

// newSessionFixture wires the router as the server does: sessions on, push devices ending with them.
func newSessionFixture(t *testing.T) (pushFixture, *services.UserService) {
	t.Helper()
	m := memstore.Compose()
	userSvc := services.NewUserService(m.Users, m.Rooms, m.Tx)
	roomSvc := services.NewRoomService(m.Users, m.Rooms, m.Tx)
	listSvc := services.NewListService(m.Users, m.Rooms, m.Lists, m.Items, categorization.NewKeywordCategorizer(categorization.GroceryAnchors))
	authSvc, err := services.NewAuthService(m.Users, filepath.Join(t.TempDir(), "enc.key"), 720)
	if err != nil {
		t.Fatal(err)
	}
	sessions := services.NewSessionService(m.Sessions, m.Users, 30*24*time.Hour)
	authSvc.UseSessions(sessions)
	userSvc.UseSessions(sessions)
	notify := services.NewNotifyService(m.Users, m.Rooms, m.Lists, m.Push, m.Push, nopSender{}, "k", []byte("0123456789abcdef0123456789abcdef"))
	notify.UseSessions(m.Sessions)
	sessions.OnEnd(func(ctx context.Context, ids []string) { _ = m.Push.DeleteBySessions(ctx, ids) })
	h := router.NewRouter(m.Users, router.Handlers{
		Auth: handlers.NewAuthHandler(authSvc), User: handlers.NewUserHandler(userSvc, []byte("salt")),
		Room: handlers.NewRoomHandler(roomSvc, m.Users, []byte("salt")), List: handlers.NewListHandler(listSvc),
		Push: handlers.NewPushHandler(notify), Sessions: sessions,
	})
	return pushFixture{h: h, m: m}, userSvc
}

func (f pushFixture) login(t *testing.T) string {
	t.Helper()
	rec := f.do(http.MethodPost, "/auth/login", `{"username":"a@b.com","password":"password123"}`, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("login: %d %s", rec.Code, rec.Body)
	}
	var out struct {
		APIKey string `json:"api_key"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return out.APIKey
}

func TestSessionsKeepEveryDeviceSignedIn(t *testing.T) {
	f, _ := newSessionFixture(t)
	if rec := f.do(http.MethodPost, "/auth/register", `{"username":"a@b.com","password":"password123","name":"Ana"}`, ""); rec.Code/100 != 2 {
		t.Fatalf("register: %d %s", rec.Code, rec.Body)
	}
	phone := f.login(t)
	mac := f.login(t)
	for name, key := range map[string]string{"phone": phone, "mac": mac} {
		if rec := f.do(http.MethodGet, "/me", "", key); rec.Code != http.StatusOK {
			t.Fatalf("%s: %d", name, rec.Code)
		}
	}

	// The phone turns on notifications under its own session.
	if rec := f.do(http.MethodPut, "/push/subscriptions", subBody("https://web.push.apple.com/phone"), phone); rec.Code != http.StatusNoContent {
		t.Fatalf("subscribe: %d %s", rec.Code, rec.Body)
	}
	if rec := f.do(http.MethodPut, "/push/subscriptions", subBody("https://fcm.googleapis.com/fcm/send/mac"), mac); rec.Code != http.StatusNoContent {
		t.Fatalf("subscribe: %d %s", rec.Code, rec.Body)
	}

	// Signing out on the phone ends only the phone: its key and its notifications.
	if rec := f.do(http.MethodPost, "/auth/logout", "", phone); rec.Code != http.StatusNoContent {
		t.Fatalf("logout: %d %s", rec.Code, rec.Body)
	}
	if rec := f.do(http.MethodGet, "/me", "", phone); rec.Code != http.StatusUnauthorized {
		t.Fatalf("phone after logout: %d", rec.Code)
	}
	if rec := f.do(http.MethodGet, "/me", "", mac); rec.Code != http.StatusOK {
		t.Fatalf("mac after the phone's logout: %d", rec.Code)
	}
	u, _ := f.m.Users.GetByUsername(context.Background(), "a@b.com")
	subs, _ := f.m.Push.ListByUsers(context.Background(), []string{u.UserID})
	if len(subs) != 1 || subs[0].Endpoint != "https://fcm.googleapis.com/fcm/send/mac" || subs[0].SessionID == "" {
		t.Fatalf("devices after logout: %+v", subs)
	}
}

func TestSessionsLegacyKeyStillWorks(t *testing.T) {
	f, userSvc := newSessionFixture(t)
	// A key from before sessions (the per-user key) keeps working, and logging out with it is a no-op.
	cu, err := userSvc.CreateUserWithSoloRoom(context.Background(), "Old")
	if err != nil {
		t.Fatal(err)
	}
	if rec := f.do(http.MethodGet, "/me", "", cu.APIKey); rec.Code != http.StatusOK {
		t.Fatalf("legacy key: %d", rec.Code)
	}
	if rec := f.do(http.MethodPost, "/auth/logout", "", cu.APIKey); rec.Code != http.StatusNoContent {
		t.Fatalf("legacy logout: %d", rec.Code)
	}
	// Signing out replaces the legacy key, so a copy of it no longer works.
	if rec := f.do(http.MethodGet, "/me", "", cu.APIKey); rec.Code != http.StatusUnauthorized {
		t.Fatalf("legacy key after logout: %d", rec.Code)
	}
	if rec := f.do(http.MethodGet, "/me", "", "garbage"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("bad key: %d", rec.Code)
	}
}
