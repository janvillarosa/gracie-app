package services

import (
	"context"
	"errors"
	"path/filepath"
	"slices"
	"testing"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

type sessionRig struct {
	m     memstore.Repos
	svc   *SessionService
	auth  *AuthService
	now   time.Time
	ended []string
}

func newSessionRig(t *testing.T) *sessionRig {
	t.Helper()
	r := &sessionRig{m: memstore.Compose(), now: time.Date(2026, 10, 19, 9, 0, 0, 0, time.UTC)}
	r.svc = NewSessionService(r.m.Sessions, r.m.Users, 30*24*time.Hour).WithClock(func() time.Time { return r.now })
	r.svc.OnEnd(func(_ context.Context, ids []string) { r.ended = append(r.ended, ids...) })
	auth, err := NewAuthService(r.m.Users, filepath.Join(t.TempDir(), "enc.key"), 720)
	if err != nil {
		t.Fatal(err)
	}
	auth.UseSessions(r.svc)
	r.auth = auth
	if err := auth.Register(context.Background(), "a@b.com", "password123", "Ana"); err != nil {
		t.Fatal(err)
	}
	return r
}

func (r *sessionRig) login(t *testing.T) string {
	t.Helper()
	lr, err := r.auth.Login(context.Background(), "a@b.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	return lr.APIKey
}

func (r *sessionRig) resolve(key string) (*models.User, string, error) {
	return r.svc.Resolve(context.Background(), key)
}

// The bug this exists for: logging in on a second device must not sign out the first.
func TestLoginOnAnotherDeviceKeepsTheFirstSignedIn(t *testing.T) {
	r := newSessionRig(t)
	phone := r.login(t)
	mac := r.login(t)
	for name, key := range map[string]string{"phone": phone, "mac": mac} {
		if u, sid, err := r.resolve(key); err != nil || u.Name != "Ana" || sid == "" {
			t.Fatalf("%s signed out: %v %v %q", name, u, err, sid)
		}
	}
	u, _ := r.m.Users.GetByUsername(context.Background(), "a@b.com")
	if u.APIKeyLookup != "" {
		t.Fatal("a session login rotated the legacy per-user key")
	}
}

func TestSessionResolveRejectsUnknownAndExpired(t *testing.T) {
	r := newSessionRig(t)
	if _, _, err := r.resolve("not-a-key"); err != derr.ErrNotFound {
		t.Fatalf("unknown key: %v", err)
	}
	key := r.login(t)
	r.now = r.now.Add(30*24*time.Hour + time.Second)
	if _, _, err := r.resolve(key); err != derr.ErrUnauthorized {
		t.Fatalf("expired key: %v", err)
	}
}

func TestLogoutEndsOnlyThatSession(t *testing.T) {
	r := newSessionRig(t)
	ctx := context.Background()
	phone, mac := r.login(t), r.login(t)
	u, phoneSID, _ := r.resolve(phone)
	if err := r.auth.Logout(ctx, u.UserID, phoneSID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := r.resolve(phone); err != derr.ErrNotFound {
		t.Fatalf("phone still signed in: %v", err)
	}
	if _, _, err := r.resolve(mac); err != nil {
		t.Fatalf("mac signed out by the phone's logout: %v", err)
	}
	if !slices.Equal(r.ended, []string{phoneSID}) {
		t.Fatalf("ended %v", r.ended)
	}
}

func TestChangePasswordSignsOutEverywhereElse(t *testing.T) {
	r := newSessionRig(t)
	ctx := context.Background()
	phone, mac := r.login(t), r.login(t)
	u, _, _ := r.resolve(mac)
	// A key from before sessions, still on some old device.
	if err := r.m.Users.SetAPIKey(ctx, u.UserID, "h", "legacy-lookup", nil, r.now); err != nil {
		t.Fatal(err)
	}
	fresh, err := r.auth.ChangePassword(ctx, u.UserID, "password123", "new-password-1")
	if err != nil {
		t.Fatal(err)
	}
	for _, old := range []string{phone, mac} {
		if _, _, err := r.resolve(old); err == nil {
			t.Fatal("an old session survived a password change")
		}
	}
	if _, _, err := r.resolve(fresh); err != nil {
		t.Fatalf("the new key does not work: %v", err)
	}
	if len(r.ended) != 2 {
		t.Fatalf("ended %v", r.ended)
	}
	if _, err := r.m.Users.GetByAPIKeyLookup(ctx, "legacy-lookup"); err == nil {
		t.Fatal("the legacy key survived a password change")
	}
}

func TestSessionsAreCappedOldestFirst(t *testing.T) {
	r := newSessionRig(t)
	var keys []string
	for range maxSessionsPerUser + 2 {
		keys = append(keys, r.login(t))
		r.now = r.now.Add(time.Second)
	}
	u, _ := r.m.Users.GetByUsername(context.Background(), "a@b.com")
	if n := r.m.Sessions.Count(u.UserID); n != maxSessionsPerUser {
		t.Fatalf("sessions %d", n)
	}
	for i, k := range keys {
		_, _, err := r.resolve(k)
		if (i < 2) != (err != nil) {
			t.Fatalf("session %d: %v", i, err)
		}
	}
	if len(r.ended) != 2 {
		t.Fatalf("ended %v", r.ended)
	}
}

func TestDeleteAccountEndsSessions(t *testing.T) {
	r := newSessionRig(t)
	ctx := context.Background()
	key := r.login(t)
	u, _, _ := r.resolve(key)
	us := NewUserService(r.m.Users, r.m.Rooms, r.m.Tx)
	us.UseSessions(r.svc)
	if err := us.DeleteAccount(ctx, u.UserID); err != nil {
		t.Fatal(err)
	}
	if n := r.m.Sessions.Count(u.UserID); n != 0 {
		t.Fatalf("sessions left: %d", n)
	}
}

// failingSessions fails every LiveIDs call (the database is unreachable).
type failingSessions struct{ *memstore.SessionRepo }

func (failingSessions) LiveIDs(context.Context, []string, time.Time) (map[string]bool, error) {
	return nil, errors.New("db down")
}

func TestNotifyRetriesWhenTheSessionCheckFails(t *testing.T) {
	r := newNotifyRig(t)
	ctx := context.Background()
	r.svc.UseSessions(failingSessions{r.m.Sessions})
	if err := r.svc.Subscribe(ctx, r.ben, SubscribeInput{SessionID: "ses_1", Endpoint: ep("ben"), P256dh: b64(65), Auth: b64(16)}); err != nil {
		t.Fatal(err)
	}
	_, _ = r.lists.CreateItem(ctx, r.ana, r.roomID, r.listID, "Milk", "", "", "")
	r.now = r.now.Add(defaultCoalesce)
	r.dispatch(t)
	if j := r.m.Push.Jobs()[0]; j.Status != models.PushJobPending {
		t.Fatalf("job dropped instead of retried: %+v", j)
	}
}
