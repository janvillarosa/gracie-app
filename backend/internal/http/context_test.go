package api

import (
    "context"
    "testing"

    "github.com/janvillarosa/gracie-app/backend/internal/models"
)

func TestUserContextRoundTrip(t *testing.T) {
    base := context.Background()
    _, ok := UserFrom(base)
    if ok { t.Fatalf("unexpected user in base context") }
    u := &models.User{UserID: "usr_test", Name: "T"}
    ctx := WithUser(base, u)
    got, ok := UserFrom(ctx)
    if !ok || got == nil || got.UserID != "usr_test" { t.Fatalf("user not round-tripped: %v %v", got, ok) }
}

