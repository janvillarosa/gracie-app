package api

import (
	"context"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

type ctxKey string

const (
	userKey    ctxKey = "user"
	sessionKey ctxKey = "session"
)

func WithUser(ctx context.Context, u *models.User) context.Context {
	return context.WithValue(ctx, userKey, u)
}

func UserFrom(ctx context.Context) (*models.User, bool) {
	if v := ctx.Value(userKey); v != nil {
		if u, ok := v.(*models.User); ok {
			return u, true
		}
	}
	return nil, false
}

// WithSession records the signed-in device's session id (empty for a legacy per-user key).
func WithSession(ctx context.Context, sessionID string) context.Context {
	return context.WithValue(ctx, sessionKey, sessionID)
}

// SessionFrom returns the request's session id, or "" for a legacy per-user key.
func SessionFrom(ctx context.Context) string {
	id, _ := ctx.Value(sessionKey).(string)
	return id
}
