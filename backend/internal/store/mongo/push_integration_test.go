//go:build integration

package mongo

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func pushRepo(t *testing.T) *PushRepo {
	t.Helper()
	r := NewPushRepo(connectOrSkip(t))
	if err := r.EnsureIndexes(context.Background()); err != nil {
		t.Fatalf("indexes: %v", err)
	}
	return r
}

func TestPushSubscriptionUpsertMovesEndpoint(t *testing.T) {
	r := pushRepo(t)
	ctx := context.Background()
	now := time.Now().UTC()
	ep := "https://fcm.googleapis.com/fcm/send/abc"
	if err := r.Upsert(ctx, &models.PushSubscription{SubID: "s1", UserID: "u1", Endpoint: ep, P256dhEnc: "k1", AuthEnc: "a1", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	// The same device signs in as u2: the endpoint moves, keeping its sub_id.
	if err := r.Upsert(ctx, &models.PushSubscription{SubID: "s2", UserID: "u2", Endpoint: ep, P256dhEnc: "k2", AuthEnc: "a2", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	got, err := r.ListByUsers(ctx, []string{"u1", "u2"})
	if err != nil || len(got) != 1 || got[0].UserID != "u2" || got[0].SubID != "s1" || got[0].P256dhEnc != "k2" {
		t.Fatalf("after move: %+v %v", got, err)
	}
	// u1 can no longer remove it; u2 can.
	_ = r.DeleteForUser(ctx, "u1", ep)
	if got, _ := r.ListByUsers(ctx, []string{"u2"}); len(got) != 1 {
		t.Fatalf("u1 removed u2's endpoint")
	}
	_ = r.DeleteForUser(ctx, "u2", ep)
	if got, _ := r.ListByUsers(ctx, []string{"u2"}); len(got) != 0 {
		t.Fatalf("not removed: %+v", got)
	}
}

func pushJob(key string, names []string, now time.Time) *models.PushJob {
	return &models.PushJob{CoalesceKey: key, Kind: models.PushKindItemAdds, RoomID: "r1", ActorID: "u1", ListID: "l1",
		URL: "/app/lists/l1", Names: names, Count: len(names), SendAfter: now, CreatedAt: now, ExpireAt: now.Add(7 * 24 * time.Hour)}
}

func TestPushJobsCoalesceAndClaim(t *testing.T) {
	r := pushRepo(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Millisecond)
	// Many instances enqueueing the same key at once still make one pending job.
	var wg sync.WaitGroup
	for _, n := range []string{"milk", "eggs", "bread", "jam", "tea", "rice", "oats"} {
		wg.Add(1)
		go func(n string) {
			defer wg.Done()
			if err := r.Enqueue(ctx, pushJob("add:r1:l1:u1", []string{n}, now), false); err != nil {
				t.Error(err)
			}
		}(n)
	}
	wg.Wait()
	j, err := r.Claim(ctx, now, time.Minute)
	if err != nil || j == nil {
		t.Fatalf("claim: %v %v", j, err)
	}
	if j.Count != 7 || len(j.Names) != 5 || j.Status != models.PushJobSending || j.Attempts != 1 {
		t.Fatalf("merged job: %+v", j)
	}
	if again, _ := r.Claim(ctx, now, time.Minute); again != nil {
		t.Fatalf("claimed twice: %+v", again)
	}
	// While it is sending, a new add starts a fresh pending job.
	if err := r.Enqueue(ctx, pushJob("add:r1:l1:u1", []string{"salt"}, now), false); err != nil {
		t.Fatal(err)
	}
	next, _ := r.Claim(ctx, now, time.Minute)
	if next == nil || next.JobID == j.JobID || next.Count != 1 {
		t.Fatalf("fresh job: %+v", next)
	}
	// A lapsed lease is claimed again (the instance died mid-send).
	re, _ := r.Claim(ctx, now.Add(2*time.Minute), time.Minute)
	if re == nil || re.Attempts != 2 {
		t.Fatalf("lapsed lease: %+v", re)
	}
	if err := r.Finish(ctx, re.JobID, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
}

func TestPushJobsOnceAndRetry(t *testing.T) {
	r := pushRepo(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Millisecond)
	key := "trip:b1:2026-10-20T09:40"
	if err := r.Enqueue(ctx, pushJob(key, nil, now), true); err != nil {
		t.Fatal(err)
	}
	j, _ := r.Claim(ctx, now, time.Minute)
	if j == nil {
		t.Fatal("no job")
	}
	// Not due yet after a retry.
	if err := r.Retry(ctx, j.JobID, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if got, _ := r.Claim(ctx, now, time.Minute); got != nil {
		t.Fatalf("retry claimed early: %+v", got)
	}
	j, _ = r.Claim(ctx, now.Add(time.Minute), time.Minute)
	if j == nil {
		t.Fatal("retry not claimed")
	}
	_ = r.Finish(ctx, j.JobID, now.Add(time.Hour))
	// The reminder ticker enqueues the same key again: once keeps it sent once.
	if err := r.Enqueue(ctx, pushJob(key, nil, now), true); err != nil {
		t.Fatal(err)
	}
	if got, _ := r.Claim(ctx, now.Add(time.Hour), time.Minute); got != nil {
		t.Fatalf("once job sent twice: %+v", got)
	}
}
