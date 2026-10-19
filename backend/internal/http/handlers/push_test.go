package handlers_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/http/handlers"
	"github.com/janvillarosa/gracie-app/backend/internal/http/router"
	"github.com/janvillarosa/gracie-app/backend/internal/push"
	"github.com/janvillarosa/gracie-app/backend/internal/services"
	"github.com/janvillarosa/gracie-app/backend/internal/services/categorization"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

type nopSender struct{}

func (nopSender) Send(context.Context, push.Subscription, []byte, push.Options) (int, error) {
	return 201, nil
}

type pushFixture struct {
	h      http.Handler
	apiKey string
	m      memstore.Repos
}

func newPushFixture(t *testing.T, withPush bool) pushFixture {
	t.Helper()
	m := memstore.Compose()
	userSvc := services.NewUserService(m.Users, m.Rooms, m.Tx)
	roomSvc := services.NewRoomService(m.Users, m.Rooms, m.Tx)
	listSvc := services.NewListService(m.Users, m.Rooms, m.Lists, m.Items, categorization.NewKeywordCategorizer(categorization.GroceryAnchors))
	authSvc, err := services.NewAuthService(m.Users, "/tmp/gracie-test-enc.key", 720)
	if err != nil {
		t.Fatal(err)
	}
	hs := router.Handlers{
		Auth: handlers.NewAuthHandler(authSvc), User: handlers.NewUserHandler(userSvc, []byte("salt")),
		Room: handlers.NewRoomHandler(roomSvc, m.Users, []byte("salt")), List: handlers.NewListHandler(listSvc),
	}
	if withPush {
		svc := services.NewNotifyService(m.Users, m.Rooms, m.Lists, m.Push, m.Push, nopSender{}, "the-public-key", []byte("0123456789abcdef0123456789abcdef"))
		hs.Push = handlers.NewPushHandler(svc)
	}
	cu, err := userSvc.CreateUserWithSoloRoom(context.Background(), "A")
	if err != nil {
		t.Fatal(err)
	}
	return pushFixture{h: router.NewRouter(m.Users, hs), apiKey: cu.APIKey, m: m}
}

func (f pushFixture) do(method, path, body, key string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	f.h.ServeHTTP(rec, req)
	return rec
}

func subBody(endpoint string) string {
	b, _ := json.Marshal(map[string]any{
		"endpoint": endpoint, "expirationTime": nil, "userAgent": "test",
		"keys": map[string]string{
			"p256dh": base64.RawURLEncoding.EncodeToString(make([]byte, 65)),
			"auth":   base64.RawURLEncoding.EncodeToString(make([]byte, 16)),
		},
	})
	return string(b)
}

func TestPushRoutesNeedAuthAndVAPID(t *testing.T) {
	off := newPushFixture(t, false)
	if rec := off.do(http.MethodGet, "/push/key", "", off.apiKey); rec.Code != http.StatusNotFound {
		t.Fatalf("push routes mounted without VAPID keys: %d", rec.Code)
	}
	on := newPushFixture(t, true)
	if rec := on.do(http.MethodGet, "/push/key", "", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("no auth: %d", rec.Code)
	}
	rec := on.do(http.MethodGet, "/push/key", "", on.apiKey)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(`"publicKey":"the-public-key"`)) {
		t.Fatalf("key: %d %s", rec.Code, rec.Body)
	}
}

func TestPushSubscribeAndUnsubscribe(t *testing.T) {
	f := newPushFixture(t, true)
	endpoint := "https://fcm.googleapis.com/fcm/send/abc"
	for range 2 { // idempotent
		if rec := f.do(http.MethodPut, "/push/subscriptions", subBody(endpoint), f.apiKey); rec.Code != http.StatusNoContent {
			t.Fatalf("subscribe: %d %s", rec.Code, rec.Body)
		}
	}
	for name, body := range map[string]string{
		"foreign host":  subBody("https://attacker.example/collect"),
		"unknown field": `{"endpoint":"https://fcm.googleapis.com/x","admin":true}`,
		"not json":      `nope`,
	} {
		if rec := f.do(http.MethodPut, "/push/subscriptions", body, f.apiKey); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", name, rec.Code)
		}
	}
	if rec := f.do(http.MethodDelete, "/push/subscriptions", `{"endpoint":"`+endpoint+`"}`, f.apiKey); rec.Code != http.StatusNoContent {
		t.Fatalf("unsubscribe: %d %s", rec.Code, rec.Body)
	}
	if rec := f.do(http.MethodDelete, "/push/subscriptions", `{}`, f.apiKey); rec.Code != http.StatusBadRequest {
		t.Fatalf("unsubscribe without endpoint: %d", rec.Code)
	}
}

func TestPushPrefs(t *testing.T) {
	f := newPushFixture(t, true)
	rec := f.do(http.MethodGet, "/me/notifications", "", f.apiKey)
	if rec.Code != http.StatusOK || rec.Body.String() != `{"itemAdds":true,"autopilot":true,"tripReminders":true}`+"\n" {
		t.Fatalf("defaults: %d %q", rec.Code, rec.Body)
	}
	rec = f.do(http.MethodPut, "/me/notifications", `{"tripReminders":false}`, f.apiKey)
	if rec.Code != http.StatusOK || rec.Body.String() != `{"itemAdds":true,"autopilot":true,"tripReminders":false}`+"\n" {
		t.Fatalf("set: %d %q", rec.Code, rec.Body)
	}
	if rec := f.do(http.MethodPut, "/me/notifications", `{}`, f.apiKey); rec.Code != http.StatusBadRequest {
		t.Fatalf("empty: %d", rec.Code)
	}
	if rec := f.do(http.MethodPut, "/me/notifications", `{"everything":false}`, f.apiKey); rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown key: %d", rec.Code)
	}
}
