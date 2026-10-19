package services

import (
	"context"
	"errors"
	"log"
	"time"

	apiauth "github.com/janvillarosa/gracie-app/backend/internal/auth"
	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
	"github.com/janvillarosa/gracie-app/backend/pkg/ids"
)

// maxSessionsPerUser caps one person's signed-in devices; the oldest session ends first.
const maxSessionsPerUser = 20

// SessionService issues and checks per-device sessions. Each login gets its own key, so signing in
// on one device never signs out another.
type SessionService struct {
	sessions store.SessionRepository
	users    store.UserRepository
	ttl      time.Duration
	// ended hears about sessions that ended, to take their push devices with them (optional).
	ended func(ctx context.Context, sessionIDs []string)
	now   func() time.Time
}

func NewSessionService(sessions store.SessionRepository, users store.UserRepository, ttl time.Duration) *SessionService {
	return &SessionService{sessions: sessions, users: users, ttl: ttl, now: time.Now}
}

// WithClock replaces the clock (tests).
func (s *SessionService) WithClock(now func() time.Time) *SessionService { s.now = now; return s }

// OnEnd registers what runs when sessions end (sign-out, password change, cap, account deletion).
func (s *SessionService) OnEnd(fn func(ctx context.Context, sessionIDs []string)) { s.ended = fn }

func (s *SessionService) end(ctx context.Context, sessionIDs []string) {
	if len(sessionIDs) > 0 && s.ended != nil {
		s.ended(ctx, sessionIDs)
	}
}

// Create starts a session for the user and returns its plain key (shown only once).
func (s *SessionService) Create(ctx context.Context, userID string) (string, *models.Session, error) {
	plain, hash, err := apiauth.GenerateAPIKey()
	if err != nil {
		return "", nil, err
	}
	now := s.now().UTC()
	ttl := s.ttl
	if ttl <= 0 {
		ttl = 30 * 24 * time.Hour
	}
	sess := &models.Session{
		SessionID: ids.NewID("ses"), UserID: userID, KeyHash: hash, KeyLookup: apiauth.DeriveLookup(plain),
		CreatedAt: now, ExpiresAt: now.Add(ttl),
	}
	if err := s.sessions.Insert(ctx, sess); err != nil {
		return "", nil, err
	}
	trimmed, err := s.sessions.TrimByUser(ctx, userID, maxSessionsPerUser)
	if err != nil {
		log.Printf("sessions: trim %s: %v", userID, err)
	}
	s.end(ctx, trimmed)
	return plain, sess, nil
}

// Resolve returns the user and session id for a bearer key. It returns derr.ErrNotFound when no
// session has the key (the caller may then try the legacy per-user key), and
// derr.ErrUnauthorized for a session key that does not verify or has expired.
func (s *SessionService) Resolve(ctx context.Context, token string) (*models.User, string, error) {
	sess, err := s.sessions.GetByLookup(ctx, apiauth.DeriveLookup(token))
	if errors.Is(err, derr.ErrNotFound) {
		return nil, "", derr.ErrNotFound
	}
	if err != nil {
		return nil, "", err
	}
	if !apiauth.VerifyAPIKey(sess.KeyHash, token) || !s.now().UTC().Before(sess.ExpiresAt) {
		return nil, "", derr.ErrUnauthorized
	}
	u, err := s.users.GetByID(ctx, sess.UserID)
	if err != nil {
		return nil, "", derr.ErrUnauthorized
	}
	return u, sess.SessionID, nil
}

// End signs one session out.
func (s *SessionService) End(ctx context.Context, sessionID string) error {
	if sessionID == "" {
		return nil
	}
	if err := s.sessions.Delete(ctx, sessionID); err != nil {
		return err
	}
	s.end(ctx, []string{sessionID})
	return nil
}

// EndAll signs the user out everywhere except keepID (empty ends every session).
func (s *SessionService) EndAll(ctx context.Context, userID, keepID string) error {
	ended, err := s.sessions.DeleteByUser(ctx, userID, keepID)
	if err != nil {
		return err
	}
	s.end(ctx, ended)
	return nil
}
