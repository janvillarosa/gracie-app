package middleware

import (
	"context"
	"errors"
	stdhttp "net/http"
	"time"

	authpkg "github.com/janvillarosa/gracie-app/backend/internal/auth"
	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	api "github.com/janvillarosa/gracie-app/backend/internal/http"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

// UserFinder defines the minimal interface auth middleware needs from user repo.
type UserFinder interface {
	GetByAPIKeyLookup(ctx context.Context, lookup string) (*models.User, error)
}

// SessionResolver resolves a per-device session key. It returns derr.ErrNotFound when no session
// has the key, so the legacy per-user key is tried next.
type SessionResolver interface {
	Resolve(ctx context.Context, token string) (*models.User, string, error)
}

// AuthMiddleware puts the caller in the context. A key is a per-device session key (sessions may be
// nil) or, for logins from before sessions, the user's own API key.
func AuthMiddleware(users UserFinder, sessions SessionResolver) func(next stdhttp.Handler) stdhttp.Handler {
	return func(next stdhttp.Handler) stdhttp.Handler {
		return stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
			token, ok := authpkg.ExtractBearer(r)
			if !ok {
				httpError(w, derr.ErrUnauthorized, stdhttp.StatusUnauthorized)
				return
			}
			if sessions != nil {
				u, sid, err := sessions.Resolve(r.Context(), token)
				if err == nil {
					ctx := api.WithSession(api.WithUser(r.Context(), u), sid)
					next.ServeHTTP(w, r.WithContext(ctx))
					return
				}
				if !errors.Is(err, derr.ErrNotFound) {
					httpError(w, derr.ErrUnauthorized, stdhttp.StatusUnauthorized)
					return
				}
			}
			lookup := authpkg.DeriveLookup(token)
			u, err := users.GetByAPIKeyLookup(r.Context(), lookup)
			if err != nil || u == nil {
				httpError(w, derr.ErrUnauthorized, stdhttp.StatusUnauthorized)
				return
			}
			if !authpkg.VerifyAPIKey(u.APIKeyHash, token) {
				httpError(w, derr.ErrUnauthorized, stdhttp.StatusUnauthorized)
				return
			}
			if u.APIKeyExpiresAt != nil && time.Now().UTC().After(*u.APIKeyExpiresAt) {
				httpError(w, derr.ErrUnauthorized, stdhttp.StatusUnauthorized)
				return
			}
			ctx := api.WithUser(r.Context(), u)
			r = r.WithContext(ctx)
			next.ServeHTTP(w, r)
		})
	}
}

func httpError(w stdhttp.ResponseWriter, err error, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_, _ = w.Write([]byte(`{"error":"` + err.Error() + `"}`))
}
