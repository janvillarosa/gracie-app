package services

import (
	"context"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

func eventually(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// seedEvents stores a few events for user in room, as if ingested an hour ago.
func seedEvents(m memstore.Repos, user, room string) {
	at := time.Now().UTC().Add(-time.Hour)
	for _, name := range []string{"item.added", "item.checked"} {
		ev := analytics.Event{
			Name: name, Source: analytics.SourceServer, ActorID: user, RoomID: room, Key: "milk",
			Subject: analytics.Ref{Type: "item", ID: "i1"}, OccurredAt: at,
		}
		analytics.Stamp(&ev, at.Add(time.Minute), "UTC", time.Hour*24*400)
		ev.EventID = name + user + room
		_ = m.Events.InsertMany(context.Background(), []analytics.Event{ev})
	}
}

// foldAll rolls everything stored so far into aggregates and profiles. One pass covers every
// seeded event: the watermark only moves forward, so seed first, then fold once.
func foldAll(t *testing.T, m memstore.Repos) {
	t.Helper()
	reg := analytics.NewRegistry()
	RegisterAnalyticsEvents(reg)
	w := analytics.NewWorker(m.Events, m.Aggs, reg)
	if _, err := w.FoldOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := w.ProfilePass(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func hasEvents(m memstore.Repos, f func(analytics.Event) bool) bool {
	for _, e := range m.Events.All() {
		if f(e) {
			return true
		}
	}
	return false
}

func TestDeleteAccountErasesBehaviorData(t *testing.T) {
	m := memstore.Compose()
	us := NewUserService(m.Users, m.Rooms, m.Tx)
	us.UsePurger(analytics.NewPurger(m.Events, m.Aggs).WithSweep(0))
	ctx := context.Background()
	a, _ := us.CreateUserWithSoloRoom(ctx, "A")
	b, _ := us.CreateUserWithSoloRoom(ctx, "B")
	roomA, roomB := *a.User.RoomID, *b.User.RoomID
	seedEvents(m, a.User.UserID, roomA)
	seedEvents(m, b.User.UserID, roomB)
	foldAll(t, m)

	if err := us.DeleteAccount(ctx, a.User.UserID); err != nil {
		t.Fatal(err)
	}
	if p, _ := m.Aggs.GetProfile(ctx, "u:"+a.User.UserID); p != nil {
		t.Fatal("profile survived account deletion")
	}
	if m.Aggs.Period("u:"+a.User.UserID+":"+time.Now().UTC().AddDate(0, 0, 0).Format("2006")) != nil {
		t.Fatal("personal period stats survived")
	}
	if hasEvents(m, func(e analytics.Event) bool { return e.ActorID == a.User.UserID }) {
		t.Fatal("raw events survived")
	}
	// The solo house went with the account (asynchronously, like the rest of the cleanup).
	eventually(t, "the deleted house's analytics to go", func() bool {
		return !hasEvents(m, func(e analytics.Event) bool { return e.RoomID == roomA }) && m.Aggs.Key(roomA+":item:milk") == nil
	})
	// Somebody else's data is untouched.
	if p, _ := m.Aggs.GetProfile(ctx, "u:"+b.User.UserID); p == nil || !hasEvents(m, func(e analytics.Event) bool { return e.ActorID == b.User.UserID }) {
		t.Fatal("another user's analytics must not be touched")
	}
}

func TestHouseDeletionErasesHouseAnalytics(t *testing.T) {
	m := memstore.Compose()
	us := NewUserService(m.Users, m.Rooms, m.Tx)
	rs := NewRoomService(m.Users, m.Rooms, m.Tx)
	rs.UsePurger(analytics.NewPurger(m.Events, m.Aggs).WithSweep(0))
	ctx := context.Background()
	a, _ := us.CreateUserWithSoloRoom(ctx, "A")
	roomA := *a.User.RoomID
	seedEvents(m, a.User.UserID, roomA)
	foldAll(t, m)

	if deleted, err := rs.VoteDeletion(ctx, a.User); err != nil || !deleted {
		t.Fatalf("vote: %v %v", deleted, err)
	}
	eventually(t, "house analytics to be erased", func() bool {
		p, _ := m.Aggs.GetProfile(ctx, "h:"+roomA)
		return p == nil && !hasEvents(m, func(e analytics.Event) bool { return e.RoomID == roomA })
	})
}

func TestJoiningDissolvesSoloHouseAggregatesButKeepsPersonalHistory(t *testing.T) {
	m := memstore.Compose()
	us := NewUserService(m.Users, m.Rooms, m.Tx)
	rs := NewRoomService(m.Users, m.Rooms, m.Tx)
	rs.UsePurger(analytics.NewPurger(m.Events, m.Aggs).WithSweep(0))
	ctx := context.Background()
	host, _ := us.CreateUserWithSoloRoom(ctx, "Host")
	guest, _ := us.CreateUserWithSoloRoom(ctx, "Guest")
	guestSolo := *guest.User.RoomID
	seedEvents(m, guest.User.UserID, guestSolo)
	foldAll(t, m)

	token, _ := rs.RotateShareToken(ctx, host.User)
	if _, err := rs.JoinRoomByToken(ctx, guest.User, token); err != nil {
		t.Fatal(err)
	}
	if p, _ := m.Aggs.GetProfile(ctx, "h:"+guestSolo); p != nil || m.Aggs.Key(guestSolo+":item:milk") != nil {
		t.Fatal("the dissolved solo house should lose its aggregates")
	}
	if p, _ := m.Aggs.GetProfile(ctx, "u:"+guest.User.UserID); p == nil {
		t.Fatal("the guest's own profile must survive joining a house")
	}
	if !hasEvents(m, func(e analytics.Event) bool { return e.ActorID == guest.User.UserID }) {
		t.Fatal("the guest's own events must survive joining a house")
	}
}

func TestPurgeSweepCatchesLateFlushedEvents(t *testing.T) {
	m := memstore.Compose()
	p := analytics.NewPurger(m.Events, m.Aggs).WithSweep(30 * time.Millisecond)
	ctx := context.Background()
	if err := p.PurgeUser(ctx, "gone"); err != nil {
		t.Fatal(err)
	}
	// An event that was still in a recorder buffer lands after the first pass.
	late := analytics.Event{EventID: "late", Name: "item.added", ActorID: "gone", RoomID: "r", Subject: analytics.Ref{Type: "item", ID: "i"}}
	_ = m.Events.InsertMany(ctx, []analytics.Event{late})
	eventually(t, "the sweep to remove the late event", func() bool {
		return !hasEvents(m, func(e analytics.Event) bool { return e.ActorID == "gone" })
	})
}
