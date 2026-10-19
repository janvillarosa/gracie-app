//go:build integration

package mongo

import (
	"context"
	"slices"
	"testing"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func sessionRepo(t *testing.T) (*SessionRepo, *Client) {
	t.Helper()
	c := connectOrSkip(t)
	r := NewSessionRepo(c)
	if err := r.EnsureIndexes(context.Background()); err != nil {
		t.Fatalf("indexes: %v", err)
	}
	return r, c
}

func session(id, user, lookup string, at time.Time) *models.Session {
	return &models.Session{SessionID: id, UserID: user, KeyHash: "h", KeyLookup: lookup, CreatedAt: at, ExpiresAt: at.Add(time.Hour)}
}

func TestMongoSessionsLookupTrimEndAndLive(t *testing.T) {
	r, _ := sessionRepo(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Millisecond)
	for i, id := range []string{"s1", "s2", "s3"} {
		if err := r.Insert(ctx, session(id, "u1", "look-"+id, now.Add(time.Duration(i)*time.Second))); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.Insert(ctx, session("s9", "u1", "look-s1", now)); err != derr.ErrConflict {
		t.Fatalf("duplicate lookup: %v", err)
	}
	if got, err := r.GetByLookup(ctx, "look-s2"); err != nil || got.SessionID != "s2" || got.UserID != "u1" {
		t.Fatalf("lookup: %+v %v", got, err)
	}
	if _, err := r.GetByLookup(ctx, "nope"); err != derr.ErrNotFound {
		t.Fatalf("missing: %v", err)
	}
	// Keep the newest two: s1 (oldest) ends.
	trimmed, err := r.TrimByUser(ctx, "u1", 2)
	if err != nil || !slices.Equal(trimmed, []string{"s1"}) {
		t.Fatalf("trim: %v %v", trimmed, err)
	}
	live, err := r.LiveIDs(ctx, []string{"s1", "s2", "s3"}, now)
	if err != nil || live["s1"] || !live["s2"] || !live["s3"] {
		t.Fatalf("live: %v %v", live, err)
	}
	if live, _ := r.LiveIDs(ctx, []string{"s2"}, now.Add(2*time.Hour)); live["s2"] {
		t.Fatal("an expired session counts as live")
	}
	ended, err := r.DeleteByUser(ctx, "u1", "s3")
	if err != nil || !slices.Equal(ended, []string{"s2"}) {
		t.Fatalf("end others: %v %v", ended, err)
	}
	if err := r.Delete(ctx, "s3"); err != nil {
		t.Fatal(err)
	}
	if _, err := r.GetByLookup(ctx, "look-s3"); err != derr.ErrNotFound {
		t.Fatalf("after delete: %v", err)
	}
}

func TestMongoPushDevicesCarryAndLoseTheirSession(t *testing.T) {
	p := pushRepo(t)
	ctx := context.Background()
	now := time.Now().UTC()
	for ep, sid := range map[string]string{"https://fcm.googleapis.com/fcm/send/a": "s1", "https://fcm.googleapis.com/fcm/send/b": "s2", "https://fcm.googleapis.com/fcm/send/c": ""} {
		if err := p.Upsert(ctx, &models.PushSubscription{SubID: "x" + sid + ep[len(ep)-1:], UserID: "u1", SessionID: sid, Endpoint: ep, CreatedAt: now, UpdatedAt: now}); err != nil {
			t.Fatal(err)
		}
	}
	if err := p.DeleteBySessions(ctx, []string{"s1"}); err != nil {
		t.Fatal(err)
	}
	subs, _ := p.ListByUsers(ctx, []string{"u1"})
	if len(subs) != 2 {
		t.Fatalf("devices: %+v", subs)
	}
	for _, s := range subs {
		if s.SessionID == "s1" {
			t.Fatal("the ended session's device is still there")
		}
	}
}
