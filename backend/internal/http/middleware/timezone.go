package middleware

import (
	"context"
	stdhttp "net/http"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	api "github.com/janvillarosa/gracie-app/backend/internal/http"
)

// Timezone reads X-Timezone, keeps it only if it is a valid IANA zone, and puts it
// in the request context so analytics can bucket events in the user's local time.
func Timezone(next stdhttp.Handler) stdhttp.Handler {
	return stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		if tz := r.Header.Get("X-Timezone"); tz != "" && len(tz) <= 64 {
			if _, err := time.LoadLocation(tz); err == nil {
				r = r.WithContext(analytics.WithTZ(r.Context(), tz))
			}
		}
		next.ServeHTTP(w, r)
	})
}

// TZStore is the slice of the user repo SyncTimezone needs.
type TZStore interface {
	UpdateTZ(ctx context.Context, userID, tz string) error
}

// SyncTimezone runs after auth and saves the user's last-seen zone, only when it
// changed, so background jobs can bucket by it. Failures never affect the request.
func SyncTimezone(users TZStore) func(stdhttp.Handler) stdhttp.Handler {
	return func(next stdhttp.Handler) stdhttp.Handler {
		return stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
			if tz := analytics.TZFrom(r.Context()); tz != "" {
				if u, ok := api.UserFrom(r.Context()); ok && u.TZ != tz {
					if err := users.UpdateTZ(r.Context(), u.UserID, tz); err == nil {
						u.TZ = tz
					}
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}
