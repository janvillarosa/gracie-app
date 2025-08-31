package middleware

import (
    "context"
    "net/http"
    "net/http/httptest"
    "testing"

    "golang.org/x/crypto/bcrypt"

    authpkg "github.com/janvillarosa/gracie-app/backend/internal/auth"
    api "github.com/janvillarosa/gracie-app/backend/internal/http"
    "github.com/janvillarosa/gracie-app/backend/internal/models"
)

type fakeFinder struct{ user *models.User; lookup string }

func (f *fakeFinder) GetByAPIKeyLookup(_ context.Context, l string) (*models.User, error) {
    if l == f.lookup { return f.user, nil }
    return nil, nil
}

func TestAuthMiddleware(t *testing.T) {
    plain := "good-key"
    lookup := authpkg.DeriveLookup(plain)
    hash, _ := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.MinCost)
    user := &models.User{UserID: "usr_test", Name: "T", APIKeyHash: string(hash)}

    mw := AuthMiddleware(&fakeFinder{user: user, lookup: lookup})

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
    if rr.Code != http.StatusUnauthorized { t.Fatalf("expected 401, got %d", rr.Code) }

    // Bad key -> 401
    rr = httptest.NewRecorder()
    req, _ = http.NewRequest("GET", "/", nil)
    req.Header.Set("Authorization", "Bearer bad")
    handler.ServeHTTP(rr, req)
    if rr.Code != http.StatusUnauthorized { t.Fatalf("expected 401, got %d", rr.Code) }

    // Good key -> 200
    rr = httptest.NewRecorder()
    req, _ = http.NewRequest("GET", "/", nil)
    req.Header.Set("Authorization", "Bearer "+plain)
    handler.ServeHTTP(rr, req)
    if rr.Code != http.StatusOK { t.Fatalf("expected 200, got %d", rr.Code) }
}
