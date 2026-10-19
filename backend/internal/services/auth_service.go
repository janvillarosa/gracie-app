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
	// sessions issues per-device keys; without it login rotates the legacy per-user key.
	sessions *SessionService
	emitter
}

// UseSessions makes login create a per-device session instead of replacing the user's one key.
func (s *AuthService) UseSessions(sessions *SessionService) { s.sessions = sessions }

func NewAuthService(users store.UserRepository, encKeyPath string, ttlHours int) (*AuthService, error) {
	key, err := crypto.LoadOrCreateKey(encKeyPath)
	if err != nil {
		return nil, err
	}
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
	if err != nil {
		return err
	}
	enc, err := crypto.Encrypt(s.key, ph)
	if err != nil {
		return err
	}
	user := &models.User{
		UserID:      userID,
		Name:        name,
		Username:    username,
		PasswordEnc: enc,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := s.users.Put(ctx, user); err != nil {
		return err
	}
	s.emitUser(ctx, "user.signed_up", userID, "", nil)
	return nil
}

type LoginResult struct {
	User   *models.User
	APIKey string
}

func (s *AuthService) Login(ctx context.Context, username, password string) (*LoginResult, error) {
	u, err := s.users.GetByUsername(ctx, username)
	if err != nil {
		return nil, derr.ErrUnauthorized
	}
	if u.PasswordEnc == "" {
		return nil, derr.ErrUnauthorized
	}
	// Decrypt stored bcrypt hash
	ph, err := crypto.Decrypt(s.key, u.PasswordEnc)
	if err != nil {
		return nil, derr.ErrUnauthorized
	}
	if bcrypt.CompareHashAndPassword(ph, []byte(password)) != nil {
		return nil, derr.ErrUnauthorized
	}
	var plain string
	if s.sessions != nil {
		// A new session for this device; the user's other devices stay signed in.
		var sess *models.Session
		if plain, sess, err = s.sessions.Create(ctx, u.UserID); err != nil {
			return nil, err
		}
		// A password change that landed after the check above ended every session but this
		// one: re-read, and refuse a login made with a password that is no longer current.
		if cur, err := s.users.GetByID(ctx, u.UserID); err != nil || cur.PasswordEnc != u.PasswordEnc {
			_ = s.sessions.End(ctx, sess.SessionID)
			return nil, derr.ErrUnauthorized
		}
	} else {
		plain, err = s.rotateLegacyKey(ctx, u.UserID, time.Now().UTC())
	}
	if err != nil {
		return nil, err
	}
	roomID := ""
	if u.RoomID != nil {
		roomID = *u.RoomID
	}
	s.emitUser(ctx, "user.logged_in", u.UserID, roomID, nil)
	return &LoginResult{User: u, APIKey: plain}, nil
}

// ChangePassword verifies the current password when present, sets the new password,
// rotates the API key, and returns the new api key. Enforces minimum length.
func (s *AuthService) ChangePassword(ctx context.Context, userID, current, next string) (string, error) {
	if len(next) < 8 {
		return "", derr.ErrBadRequest
	}
	u, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return "", derr.ErrUnauthorized
	}
	if u.PasswordEnc != "" {
		if current == "" {
			return "", derr.ErrBadRequest
		}
		ph, err := crypto.Decrypt(s.key, u.PasswordEnc)
		if err != nil {
			return "", derr.ErrUnauthorized
		}
		if bcrypt.CompareHashAndPassword(ph, []byte(current)) != nil {
			return "", derr.ErrUnauthorized
		}
	}
	// Hash and encrypt new password
	phNew, err := bcrypt.GenerateFromPassword([]byte(next), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	enc, err := crypto.Encrypt(s.key, phNew)
	if err != nil {
		return "", err
	}
	now := time.Now().UTC()
	if err := s.users.UpdatePasswordEnc(ctx, userID, enc, now); err != nil {
		return "", err
	}

	// A new password signs the account out everywhere: the legacy key is replaced and every
	// session ends. This device gets a fresh key, so it stays signed in.
	plain, err := s.rotateLegacyKey(ctx, userID, now)
	if err != nil {
		return "", err
	}
	if s.sessions != nil {
		if err := s.sessions.EndAll(ctx, userID, ""); err != nil {
			return "", err
		}
		if plain, _, err = s.sessions.Create(ctx, userID); err != nil {
			return "", err
		}
	}
	s.emitUser(ctx, "user.password_changed", userID, "", nil)
	return plain, nil
}

// rotateLegacyKey replaces the user's own API key (the one logins used before sessions) and
// returns the new plain key.
func (s *AuthService) rotateLegacyKey(ctx context.Context, userID string, now time.Time) (string, error) {
	plain, hash, err := apiauth.GenerateAPIKey()
	if err != nil {
		return "", err
	}
	var exp *time.Time
	if s.ttl > 0 {
		e := now.Add(s.ttl)
		exp = &e
	}
	if err := s.users.SetAPIKey(ctx, userID, hash, apiauth.DeriveLookup(plain), exp, now); err != nil {
		return "", err
	}
	return plain, nil
}

// Logout signs the current device out: its session ends (with its push devices). A legacy key is
// replaced (and the new one thrown away), so it stops working: only one device can hold it.
func (s *AuthService) Logout(ctx context.Context, userID, sessionID string) error {
	if sessionID == "" {
		_, err := s.rotateLegacyKey(ctx, userID, time.Now().UTC())
		return err
	}
	if s.sessions == nil {
		return nil
	}
	return s.sessions.End(ctx, sessionID)
}
