package services

import (
    "context"
    "path/filepath"
    "testing"

    derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
    "github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

func TestAuthRegisterLoginChangePassword(t *testing.T) {
    _, users, _, _, _ := memstore.Compose()
    keyPath := filepath.Join(t.TempDir(), "enc.key")
    auth, err := NewAuthService(users, keyPath, 1)
    if err != nil { t.Fatalf("auth svc: %v", err) }
    ctx := context.Background()

    // Invalid registration
    if err := auth.Register(ctx, "bad", "short", ""); err != derr.ErrBadRequest {
        t.Fatalf("want bad request, got %v", err)
    }

    // Register
    if err := auth.Register(ctx, "a@b.com", "password123", "Alice"); err != nil {
        t.Fatalf("register: %v", err)
    }
    // Duplicate
    if err := auth.Register(ctx, "a@b.com", "password123", "Alice"); err != derr.ErrConflict {
        t.Fatalf("want conflict on dup username, got %v", err)
    }

    // Login
    lr, err := auth.Login(ctx, "a@b.com", "password123")
    if err != nil || lr == nil || lr.APIKey == "" { t.Fatalf("login failed: %v %v", lr, err) }

    // Wrong password
    if _, err := auth.Login(ctx, "a@b.com", "x"); err != derr.ErrUnauthorized {
        t.Fatalf("want unauthorized, got %v", err)
    }

    // Change password requires current
    if _, err := auth.ChangePassword(ctx, lr.User.UserID, "", "newpassword"); err != derr.ErrBadRequest {
        t.Fatalf("want bad request when missing current, got %v", err)
    }
    // Provide current and rotate
    newKey, err := auth.ChangePassword(ctx, lr.User.UserID, "password123", "newpassword")
    if err != nil || newKey == "" { t.Fatalf("change password: %v %q", err, newKey) }
}

