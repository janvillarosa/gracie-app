package services

import (
    "context"
    "regexp"
    "time"

    apiauth "github.com/janvillarosa/gracie-app/backend/internal/auth"
    "github.com/janvillarosa/gracie-app/backend/internal/crypto"
    derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
    "github.com/janvillarosa/gracie-app/backend/internal/models"
    "github.com/janvillarosa/gracie-app/backend/internal/store"
    "github.com/janvillarosa/gracie-app/backend/pkg/ids"
    "golang.org/x/crypto/bcrypt"
)

var emailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

type AuthService struct {
    users store.UserRepository
    key   []byte
    ttl   time.Duration
}

func NewAuthService(users store.UserRepository, encKeyPath string, ttlHours int) (*AuthService, error) {
    key, err := crypto.LoadOrCreateKey(encKeyPath)
    if err != nil { return nil, err }
    ttl := time.Duration(ttlHours) * time.Hour
    return &AuthService{users: users, key: key, ttl: ttl}, nil
}

func (s *AuthService) Register(ctx context.Context, username, password, name string) error {
    if !emailRe.MatchString(username) || len(password) < 8 {
        return derr.ErrBadRequest
    }
    now := time.Now().UTC()
    // Ensure username uniqueness (best-effort via GSI query)
    if _, err := s.users.GetByUsername(ctx, username); err == nil {
        return derr.ErrConflict
    }
    userID := ids.NewID("usr")
    // Hash password with bcrypt, then encrypt the hash at-rest
    ph, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
    if err != nil { return err }
    enc, err := crypto.Encrypt(s.key, ph)
    if err != nil { return err }
    user := &models.User{
        UserID:      userID,
        Name:        name,
        Username:    username,
        PasswordEnc: enc,
        CreatedAt:   now,
        UpdatedAt:   now,
    }
    return s.users.Put(ctx, user)
}

type LoginResult struct {
    User   *models.User
    APIKey string
}

func (s *AuthService) Login(ctx context.Context, username, password string) (*LoginResult, error) {
    u, err := s.users.GetByUsername(ctx, username)
    if err != nil { return nil, derr.ErrUnauthorized }
    if u.PasswordEnc == "" {
        return nil, derr.ErrUnauthorized
    }
    // Decrypt stored bcrypt hash
    ph, err := crypto.Decrypt(s.key, u.PasswordEnc)
    if err != nil { return nil, derr.ErrUnauthorized }
    if bcrypt.CompareHashAndPassword(ph, []byte(password)) != nil {
        return nil, derr.ErrUnauthorized
    }
    // Rotate API key and return plain to client
    plain, hash, err := apiauth.GenerateAPIKey()
    if err != nil { return nil, err }
    lookup := apiauth.DeriveLookup(plain)
    now := time.Now().UTC()
    var exp *time.Time
    if s.ttl > 0 {
        e := now.Add(s.ttl)
        exp = &e
    }
    if err := s.users.SetAPIKey(ctx, u.UserID, hash, lookup, exp, now); err != nil {
        return nil, err
    }
    return &LoginResult{User: u, APIKey: plain}, nil
}

// ChangePassword verifies the current password when present, sets the new password,
// rotates the API key, and returns the new api key. Enforces minimum length.
func (s *AuthService) ChangePassword(ctx context.Context, userID, current, next string) (string, error) {
    if len(next) < 8 { return "", derr.ErrBadRequest }
    u, err := s.users.GetByID(ctx, userID)
    if err != nil { return "", derr.ErrUnauthorized }
    if u.PasswordEnc != "" {
        if current == "" { return "", derr.ErrBadRequest }
        ph, err := crypto.Decrypt(s.key, u.PasswordEnc)
        if err != nil { return "", derr.ErrUnauthorized }
        if bcrypt.CompareHashAndPassword(ph, []byte(current)) != nil { return "", derr.ErrUnauthorized }
    }
    // Hash and encrypt new password
    phNew, err := bcrypt.GenerateFromPassword([]byte(next), bcrypt.DefaultCost)
    if err != nil { return "", err }
    enc, err := crypto.Encrypt(s.key, phNew)
    if err != nil { return "", err }
    now := time.Now().UTC()
    if err := s.users.UpdatePasswordEnc(ctx, userID, enc, now); err != nil { return "", err }

    // Rotate API key
    plain, hash, err := apiauth.GenerateAPIKey()
    if err != nil { return "", err }
    lookup := apiauth.DeriveLookup(plain)
    var exp *time.Time
    if s.ttl > 0 {
        e := now.Add(s.ttl)
        exp = &e
    }
    if err := s.users.SetAPIKey(ctx, userID, hash, lookup, exp, now); err != nil { return "", err }
    return plain, nil
}
