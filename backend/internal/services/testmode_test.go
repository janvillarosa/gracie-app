package services

import (
	"context"
	"strings"
	"testing"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
)

// testRig is a notifyRig whose three people are all test accounts unless a test changes that.
func newTestModeRig(t *testing.T) (*notifyRig, *TestModeService) {
	t.Helper()
	r := newNotifyRig(t)
	ctx := context.Background()
	for _, id := range []string{"u_ana", "u_ben", "u_cy"} {
		if err := r.m.Users.SetTestAccount(ctx, id, true, r.now); err != nil {
			t.Fatal(err)
		}
	}
	r.ana, _ = r.m.Users.GetByID(ctx, "u_ana")
	tm := NewTestModeService(r.m.Users, r.m.Rooms)
	tm.UseNotify(r.svc)
	return r, tm
}

func TestTestModeHidesFromEveryoneElse(t *testing.T) {
	r, tm := newTestModeRig(t)
	ctx := context.Background()
	_ = r.m.Users.SetTestAccount(ctx, "u_ana", false, r.now)
	plain, _ := r.m.Users.GetByID(ctx, "u_ana")
	if _, err := tm.List(plain); err != derr.ErrNotFound {
		t.Fatalf("list for a normal account: %v", err)
	}
	if _, err := tm.Run(ctx, plain, "push.test"); err != derr.ErrNotFound {
		t.Fatalf("run for a normal account: %v", err)
	}
	if _, err := tm.Run(ctx, r.ana, "nope"); err != derr.ErrNotFound {
		t.Fatalf("unknown action: %v", err)
	}
	acts, err := tm.List(r.ana)
	if err != nil || len(acts) != 4 || acts[0].ID != "push.test" {
		t.Fatalf("list: %+v %v", acts, err)
	}
}

func TestTestModePushTestGoesToOwnDevicesOnly(t *testing.T) {
	r, tm := newTestModeRig(t)
	ctx := context.Background()
	if msg, err := tm.Run(ctx, r.ana, "push.test"); err != nil || !strings.Contains(msg, "no devices") {
		t.Fatalf("no devices: %q %v", msg, err)
	}
	r.subscribe(t, r.ana, ep("ana-1"))
	r.subscribe(t, r.ana, ep("ana-2"))
	r.subscribe(t, r.ben, ep("ben"))
	r.send.status[ep("ana-2")] = 410
	msg, err := tm.Run(ctx, r.ana, "push.test")
	if err != nil || msg != "Sent to 1 of 2 devices. Google: subscription expired, removed (410)." {
		t.Fatalf("run: %q %v", msg, err)
	}
	for _, s := range r.send.sent {
		if s.Endpoint == ep("ben") {
			t.Fatal("a housemate got the test push")
		}
	}
	if subs, _ := r.m.Push.ListByUsers(ctx, []string{"u_ana"}); len(subs) != 1 {
		t.Fatalf("gone device kept: %+v", subs)
	}
}

func TestTestModeSimulatedAddsMergeAndReachTheTester(t *testing.T) {
	r, tm := newTestModeRig(t)
	ctx := context.Background()
	r.subscribe(t, r.ana, ep("ana"))
	msg, err := tm.Run(ctx, r.ana, "push.burst")
	if err != nil || !strings.Contains(msg, `"Groceries"`) {
		t.Fatalf("burst: %q %v", msg, err)
	}
	if jobs := r.m.Push.Jobs(); len(jobs) != 1 || jobs[0].Count != 5 {
		t.Fatalf("not merged into one job: %+v", jobs)
	}
	if n := r.dispatch(t); n != 0 {
		t.Fatal("sent inside the merge window")
	}
	r.now = r.now.Add(defaultCoalesce)
	if n := r.dispatch(t); n != 1 {
		t.Fatalf("sent %d", n)
	}
	if b := r.send.sent[len(r.send.sent)-1].Msg.Body; b != "Someone added Test item 1, Test item 2 and 3 more" {
		t.Fatalf("body %q", b)
	}
}

func TestTestModeTripSampleAndDispatch(t *testing.T) {
	r, tm := newTestModeRig(t)
	ctx := context.Background()
	r.subscribe(t, r.ana, ep("ana"))
	r.subscribe(t, r.ben, ep("ben"))
	if _, err := tm.Run(ctx, r.ana, "push.trip"); err != nil {
		t.Fatal(err)
	}
	msg, err := tm.Run(ctx, r.ana, "push.dispatch")
	if err != nil || msg != "Sent 1." {
		t.Fatalf("dispatch: %q %v", msg, err)
	}
	if s := r.send.sent[len(r.send.sent)-1]; s.Endpoint != ep("ana") || s.Msg.Body != "Tram 28 at 10:30" {
		t.Fatalf("sample: %+v", s)
	}
}

func TestTestModeNeverActsOnRealHousemates(t *testing.T) {
	r, tm := newTestModeRig(t)
	ctx := context.Background()
	r.subscribe(t, r.ben, ep("ben"))
	_ = r.m.Users.SetTestAccount(ctx, "u_cy", false, r.now) // Cy is a real person
	if _, err := tm.Run(ctx, r.ana, "push.burst"); err != ErrNeedsTestHouse {
		t.Fatalf("burst with a real housemate: %v", err)
	}
	if len(r.m.Push.Jobs()) != 0 {
		t.Fatal("a job was queued for real people")
	}
	// An action that stays with the tester still works.
	if _, err := tm.Run(ctx, r.ana, "push.test"); err != nil {
		t.Fatalf("own-device action refused: %v", err)
	}
}

func TestTestModeAutopilotRunsOnlyTheTestersHouse(t *testing.T) {
	r := assistHouse(t, 10*time.Hour)
	ctx := context.Background()
	if err := r.m.Users.SetTestAccount(ctx, r.user.UserID, true, r.now); err != nil {
		t.Fatal(err)
	}
	tester, _ := r.m.Users.GetByID(ctx, r.user.UserID)
	tm := NewTestModeService(r.m.Users, r.m.Rooms)
	tm.UseAutopilot(r.svc)

	msg, err := tm.Run(ctx, tester, "autopilot.tick")
	if err != nil || msg != "Added 2 items." || len(r.autopilotItems()) != 2 {
		t.Fatalf("tick: %q %v items=%d", msg, err, len(r.autopilotItems()))
	}
	// Running it again adds nothing: the action log's unique key holds.
	if msg, _ := tm.Run(ctx, tester, "autopilot.tick"); msg != "Nothing to add right now." {
		t.Fatalf("second tick: %q", msg)
	}
	_ = r.m.Rooms.SetAutopilotMode(ctx, r.roomID, r.user.UserID, "suggest", r.now)
	if msg, _ := tm.Run(ctx, tester, "autopilot.tick"); !strings.Contains(msg, "not on assist mode") {
		t.Fatalf("suggest house: %q", msg)
	}
	// A server with no executor says so instead of failing.
	if _, err := NewAutopilotService(r.m.Rooms, r.m.Lists, r.m.Items, nil, nil, SuggestionsOn).TickRoom(ctx, r.roomID); err != ErrAutopilotUnavailable {
		t.Fatalf("unavailable: %v", err)
	}
}
