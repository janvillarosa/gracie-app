package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"golang.org/x/crypto/bcrypt"

	authpkg "github.com/janvillarosa/gracie-app/backend/internal/auth"
	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	api "github.com/janvillarosa/gracie-app/backend/internal/http"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

type fakeFinder struct {
	user   *models.User
	lookup string
}

func (f *fakeFinder) GetByAPIKeyLookup(_ context.Context, l string) (*models.User, error) {
	if l == f.lookup {
		return f.user, nil
	}
	return nil, nil
}

func TestAuthMiddleware(t *testing.T) {
	plain := "good-key"
	lookup := authpkg.DeriveLookup(plain)
	hash, _ := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.MinCost)
	user := &models.User{UserID: "usr_test", Name: "T", APIKeyHash: string(hash)}

	mw := AuthMiddleware(&fakeFinder{user: user, lookup: lookup}, nil)

	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if u, ok := api.UserFrom(r.Context()); !ok || u.UserID != "usr_test" {
			t.Fatalf("user not in context")
		}
		w.WriteHeader(http.StatusOK)
	}))

	// No header -> 401
	rr := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/", nil)
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}

	// Bad key -> 401
	rr = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer bad")
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}

	// Good key -> 200
	rr = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+plain)
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
}

// fakeSessions answers every key with err (and a user when err is nil).
type fakeSessions struct {
	user *models.User
	err  error
}

func (f fakeSessions) Resolve(context.Context, string) (*models.User, string, error) {
	if f.err != nil {
		return nil, "", f.err
	}
	return f.user, "ses_1", nil
}

// Only "no session has this key" may fall back to the legacy per-user key: a refused or expired
// session, or a failed lookup, must be a 401 even if the same key would pass as a legacy key.
func TestAuthMiddlewareFallsBackOnlyWhenNoSessionHasTheKey(t *testing.T) {
	plain := "good-key"
	hash, _ := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.MinCost)
	legacy := &models.User{UserID: "usr_legacy", APIKeyHash: string(hash)}
	finder := &fakeFinder{user: legacy, lookup: authpkg.DeriveLookup(plain)}
	for name, tc := range map[string]struct {
		sessions fakeSessions
		code     int
		user     string
		session  string
	}{
		"session":         {fakeSessions{user: &models.User{UserID: "usr_s"}}, 200, "usr_s", "ses_1"},
		"no session":      {fakeSessions{err: derr.ErrNotFound}, 200, "usr_legacy", ""},
		"expired session": {fakeSessions{err: derr.ErrUnauthorized}, 401, "", ""},
		"lookup failed":   {fakeSessions{err: errors.New("db down")}, 401, "", ""},
	} {
		var gotUser, gotSession string
		h := AuthMiddleware(finder, tc.sessions)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u, _ := api.UserFrom(r.Context())
			gotUser, gotSession = u.UserID, api.SessionFrom(r.Context())
			w.WriteHeader(http.StatusOK)
		}))
		rr := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/", nil)
		req.Header.Set("Authorization", "Bearer "+plain)
		h.ServeHTTP(rr, req)
		if rr.Code != tc.code || gotUser != tc.user || gotSession != tc.session {
			t.Errorf("%s: %d user=%q session=%q", name, rr.Code, gotUser, gotSession)
		}
	}
}
