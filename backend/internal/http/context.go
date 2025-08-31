package api

import (
    "context"
    "github.com/janvillarosa/gracie-app/backend/internal/models"
)

type ctxKey string

const userKey ctxKey = "user"

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
