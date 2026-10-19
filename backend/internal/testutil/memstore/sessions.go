package memstore

import (
	"context"
	"sort"
	"sync"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

// SessionRepo mirrors store/mongo.SessionRepo: unique key lookup. There is no TTL here, so an
// expired session stays until deleted; callers check ExpiresAt, as they must in Mongo between TTL
// sweeps.
type SessionRepo struct {
	mu   sync.Mutex
	rows map[string]*models.Session // by session id
}

func NewSessionRepo() *SessionRepo { return &SessionRepo{rows: map[string]*models.Session{}} }

func (r *SessionRepo) Insert(_ context.Context, s *models.Session) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, x := range r.rows {
		if x.SessionID == s.SessionID || x.KeyLookup == s.KeyLookup {
			return derr.ErrConflict
		}
	}
	cp := *s
	r.rows[s.SessionID] = &cp
	return nil
}

func (r *SessionRepo) GetByLookup(_ context.Context, lookup string) (*models.Session, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, x := range r.rows {
		if x.KeyLookup == lookup {
			cp := *x
			return &cp, nil
		}
	}
	return nil, derr.ErrNotFound
}

func (r *SessionRepo) Delete(_ context.Context, sessionID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.rows, sessionID)
	return nil
}

func (r *SessionRepo) DeleteByUser(_ context.Context, userID, keepID string) ([]string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []string
	for id, x := range r.rows {
		if x.UserID == userID && id != keepID {
			out = append(out, id)
			delete(r.rows, id)
		}
	}
	return out, nil
}

func (r *SessionRepo) TrimByUser(_ context.Context, userID string, keep int) ([]string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var mine []*models.Session
	for _, x := range r.rows {
		if x.UserID == userID {
			mine = append(mine, x)
		}
	}
	sort.Slice(mine, func(i, j int) bool { return mine[i].CreatedAt.After(mine[j].CreatedAt) })
	var out []string
	for i := keep; i < len(mine); i++ {
		out = append(out, mine[i].SessionID)
		delete(r.rows, mine[i].SessionID)
	}
	return out, nil
}

func (r *SessionRepo) LiveIDs(_ context.Context, ids []string, now time.Time) (map[string]bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := map[string]bool{}
	for _, id := range ids {
		if x, ok := r.rows[id]; ok && now.Before(x.ExpiresAt) {
			out[id] = true
		}
	}
	return out, nil
}

// Count is how many sessions the user has, for tests.
func (r *SessionRepo) Count(userID string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := 0
	for _, x := range r.rows {
		if x.UserID == userID {
			n++
		}
	}
	return n
}
