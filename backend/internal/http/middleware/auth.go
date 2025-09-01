package middleware

import (
    "context"
    "time"
    stdhttp "net/http"

	authpkg "github.com/janvillarosa/gracie-app/backend/internal/auth"
	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	api "github.com/janvillarosa/gracie-app/backend/internal/http"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

// UserFinder defines the minimal interface auth middleware needs from user repo.
type UserFinder interface {
	GetByAPIKeyLookup(ctx context.Context, lookup string) (*models.User, error)
}

func AuthMiddleware(users UserFinder) func(next stdhttp.Handler) stdhttp.Handler {
	return func(next stdhttp.Handler) stdhttp.Handler {
		return stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
			token, ok := authpkg.ExtractBearer(r)
			if !ok {
				httpError(w, derr.ErrUnauthorized, stdhttp.StatusUnauthorized)
				return
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
