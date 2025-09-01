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
