package services

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/push"
	"github.com/janvillarosa/gracie-app/backend/internal/services/categorization"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

// fakeSender records sends and answers with a per-endpoint status (201 by default).
type fakeSender struct {
	mu     sync.Mutex
	status map[string]int
	sent   []sentPush
}

type sentPush struct {
	Endpoint string
	Msg      push.Message
	Topic    string
}

func (f *fakeSender) Send(_ context.Context, sub push.Subscription, payload []byte, opts push.Options) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var m push.Message
	_ = json.Unmarshal(payload, &m)
	f.sent = append(f.sent, sentPush{sub.Endpoint, m, opts.Topic})
	if s, ok := f.status[sub.Endpoint]; ok {
		return s, nil
	}
	return 201, nil
}

type notifyRig struct {
	m      memstore.Repos
	svc    *NotifyService
	lists  *ListService
	send   *fakeSender
	now    time.Time
	roomID string
	listID string
	ana    *models.User
	ben    *models.User
	cy     *models.User
}

var testEncKey = []byte("0123456789abcdef0123456789abcdef")

func newNotifyRig(t *testing.T) *notifyRig {
	t.Helper()
	ctx := context.Background()
	m := memstore.Compose()
	r := &notifyRig{m: m, send: &fakeSender{status: map[string]int{}}, now: time.Date(2026, 10, 19, 9, 0, 0, 0, time.UTC), roomID: "room_1"}
	room := "room_1"
	for _, u := range []*models.User{{UserID: "u_ana", Name: "Ana"}, {UserID: "u_ben", Name: "Ben"}, {UserID: "u_cy", Name: "Cy"}} {
		u.RoomID = &room
		if err := m.Users.Put(ctx, u); err != nil {
			t.Fatal(err)
		}
	}
	r.ana, _ = m.Users.GetByID(ctx, "u_ana")
	r.ben, _ = m.Users.GetByID(ctx, "u_ben")
	r.cy, _ = m.Users.GetByID(ctx, "u_cy")
	if err := m.Rooms.Put(ctx, &models.Room{RoomID: room, MemberIDs: []string{"u_ana", "u_ben", "u_cy"}}); err != nil {
		t.Fatal(err)
	}
	r.lists = NewListService(m.Users, m.Rooms, m.Lists, m.Items, categorization.NewKeywordCategorizer(categorization.GroceryAnchors))
	l, err := r.lists.CreateList(ctx, r.ana, room, "Groceries", "", "")
	if err != nil {
		t.Fatal(err)
	}
	r.listID = l.ListID
	r.svc = NewNotifyService(m.Users, m.Rooms, m.Lists, m.Push, m.Push, r.send, "pub", testEncKey).WithClock(func() time.Time { return r.now })
	r.svc.UseTrips(m.Trips)
	r.lists.UseNotifier(r.svc)
	return r
}

func b64(n int) string { return base64.RawURLEncoding.EncodeToString(make([]byte, n)) }

func (r *notifyRig) subscribe(t *testing.T, u *models.User, endpoint string) {
	t.Helper()
	if err := r.svc.Subscribe(context.Background(), u, SubscribeInput{Endpoint: endpoint, P256dh: b64(65), Auth: b64(16)}); err != nil {
		t.Fatalf("subscribe %s: %v", endpoint, err)
	}
}

func (r *notifyRig) dispatch(t *testing.T) int {
	t.Helper()
	n, err := r.svc.DispatchOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func ep(name string) string { return "https://fcm.googleapis.com/fcm/send/" + name }

func TestNotifyCoalescesAddsAndSkipsTheActor(t *testing.T) {
	r := newNotifyRig(t)
	ctx := context.Background()
	r.subscribe(t, r.ana, ep("ana"))
	r.subscribe(t, r.ben, ep("ben-phone"))
	r.subscribe(t, r.ben, ep("ben-laptop"))
	for _, d := range []string{"Milk", "Eggs", "Bread", "Jam"} {
		if _, err := r.lists.CreateItem(ctx, r.ana, r.roomID, r.listID, d, "", "", ""); err != nil {
			t.Fatal(err)
		}
	}
	if n := r.dispatch(t); n != 0 {
		t.Fatalf("sent before the coalesce window ended: %d", n)
	}
	r.now = r.now.Add(defaultCoalesce)
	if n := r.dispatch(t); n != 2 {
		t.Fatalf("want one push to each of Ben's devices, got %d: %+v", n, r.send.sent)
	}
	for _, s := range r.send.sent {
		if s.Endpoint == ep("ana") {
			t.Fatal("the actor was notified of her own adds")
		}
		if s.Msg.Title != "Groceries" || s.Msg.Body != "Ana added Milk, Eggs and 2 more" || s.Msg.URL != "/app/lists/"+r.listID || s.Msg.Tag != "list:"+r.listID {
			t.Fatalf("message: %+v", s.Msg)
		}
	}
	if n := r.dispatch(t); n != 0 {
		t.Fatalf("job sent twice: %d", n)
	}
}

func TestNotifyRespectsPrefs(t *testing.T) {
	r := newNotifyRig(t)
	ctx := context.Background()
	r.subscribe(t, r.ben, ep("ben"))
	r.subscribe(t, r.cy, ep("cy"))
	off := false
	got, err := r.svc.SetPrefs(ctx, r.cy, NotifyPrefsPatch{ItemAdds: &off})
	if err != nil || got.ItemAdds || !got.Autopilot || !got.TripReminders {
		t.Fatalf("prefs: %+v %v", got, err)
	}
	if _, err := r.svc.SetPrefs(ctx, r.cy, NotifyPrefsPatch{}); err != derr.ErrBadRequest {
		t.Fatalf("empty patch: %v", err)
	}
	_, _ = r.lists.CreateItem(ctx, r.ana, r.roomID, r.listID, "Milk", "", "", "")
	r.now = r.now.Add(defaultCoalesce)
	r.dispatch(t)
	if len(r.send.sent) != 1 || r.send.sent[0].Endpoint != ep("ben") || r.send.sent[0].Msg.Body != "Ana added Milk" {
		t.Fatalf("sent: %+v", r.send.sent)
	}
}

func TestNotifyAutopilotAddsGoToEveryone(t *testing.T) {
	r := newNotifyRig(t)
	ctx := context.Background()
	r.subscribe(t, r.ana, ep("ana"))
	r.subscribe(t, r.ben, ep("ben"))
	for _, d := range []string{"Milk", "Eggs"} {
		if _, err := r.lists.CreateSystemItem(ctx, ActorAutopilot, SourceAutopilot, r.roomID, r.listID, d, "", "", ""); err != nil {
			t.Fatal(err)
		}
	}
	r.now = r.now.Add(defaultCoalesce)
	if n := r.dispatch(t); n != 2 {
		t.Fatalf("sent %d: %+v", n, r.send.sent)
	}
	if b := r.send.sent[0].Msg.Body; b != "Butler added Milk and Eggs" {
		t.Fatalf("body %q", b)
	}
}

func TestNotifyDropsGoneDevicesAndRetries(t *testing.T) {
	r := newNotifyRig(t)
	ctx := context.Background()
	r.subscribe(t, r.ben, ep("gone"))
	r.subscribe(t, r.ben, ep("busy"))
	r.send.status[ep("gone")] = 410
	r.send.status[ep("busy")] = 503
	_, _ = r.lists.CreateItem(ctx, r.ana, r.roomID, r.listID, "Milk", "", "", "")
	r.now = r.now.Add(defaultCoalesce)
	r.dispatch(t)
	subs, _ := r.m.Push.ListByUsers(ctx, []string{"u_ben"})
	if len(subs) != 1 || subs[0].Endpoint != ep("busy") {
		t.Fatalf("410 device kept: %+v", subs)
	}
	jobs := r.m.Push.Jobs()
	if len(jobs) != 1 || jobs[0].Status != models.PushJobPending || !jobs[0].SendAfter.After(r.now) {
		t.Fatalf("503 not retried later: %+v", jobs)
	}
	// The push service recovers: the retry is sent with the same topic, and the job is done.
	delete(r.send.status, ep("busy"))
	r.now = jobs[0].SendAfter
	if n := r.dispatch(t); n != 1 {
		t.Fatalf("retry sent %d", n)
	}
	if first, last := r.send.sent[1].Topic, r.send.sent[len(r.send.sent)-1].Topic; first != last {
		t.Fatalf("retry changed topic: %s %s", first, last)
	}
	if j := r.m.Push.Jobs()[0]; j.Status != models.PushJobDone {
		t.Fatalf("job: %+v", j)
	}
}

func TestNotifyGivesUpAfterMaxAttempts(t *testing.T) {
	r := newNotifyRig(t)
	ctx := context.Background()
	r.subscribe(t, r.ben, ep("busy"))
	r.send.status[ep("busy")] = 500
	_, _ = r.lists.CreateItem(ctx, r.ana, r.roomID, r.listID, "Milk", "", "", "")
	r.now = r.now.Add(defaultCoalesce)
	for range pushMaxAttempts {
		r.dispatch(t)
		r.now = r.now.Add(24 * time.Hour)
	}
	if j := r.m.Push.Jobs()[0]; j.Status != models.PushJobDone || j.Attempts != pushMaxAttempts {
		t.Fatalf("job: %+v", j)
	}
}

func TestNotifyRetriesAfterALapsedLease(t *testing.T) {
	r := newNotifyRig(t)
	ctx := context.Background()
	r.subscribe(t, r.ben, ep("ben"))
	_, _ = r.lists.CreateItem(ctx, r.ana, r.roomID, r.listID, "Milk", "", "", "")
	r.now = r.now.Add(defaultCoalesce)
	// An instance claims the job and dies before sending.
	if j, _ := r.m.Push.Claim(ctx, r.now, pushLease); j == nil {
		t.Fatal("no job")
	}
	if n := r.dispatch(t); n != 0 {
		t.Fatal("sent while another instance held the lease")
	}
	r.now = r.now.Add(pushLease + time.Second)
	if n := r.dispatch(t); n != 1 {
		t.Fatalf("lapsed lease not retried: %d", n)
	}
}

func TestNotifySkipsDeletedListsAndGoneHouses(t *testing.T) {
	r := newNotifyRig(t)
	ctx := context.Background()
	r.subscribe(t, r.ben, ep("ben"))
	_, _ = r.lists.CreateItem(ctx, r.ana, r.roomID, r.listID, "Milk", "", "", "")
	_ = r.m.Lists.Delete(ctx, r.listID)
	r.now = r.now.Add(defaultCoalesce)
	if n := r.dispatch(t); n != 0 {
		t.Fatal("sent for a deleted list")
	}
	if j := r.m.Push.Jobs()[0]; j.Status != models.PushJobDone {
		t.Fatalf("job left pending: %+v", j)
	}
}

func TestNotifySubscribeValidates(t *testing.T) {
	r := newNotifyRig(t)
	ctx := context.Background()
	bad := []SubscribeInput{
		{Endpoint: "https://attacker.example/x", P256dh: b64(65), Auth: b64(16)},
		{Endpoint: "http://fcm.googleapis.com/x", P256dh: b64(65), Auth: b64(16)},
		{Endpoint: ep("a"), P256dh: b64(10), Auth: b64(16)},
		{Endpoint: ep("a"), P256dh: b64(65), Auth: "not base64!"},
	}
	for _, in := range bad {
		if err := r.svc.Subscribe(ctx, r.ana, in); err != derr.ErrBadRequest {
			t.Errorf("%+v: %v", in, err)
		}
	}
	// Keys are encrypted at rest.
	r.subscribe(t, r.ana, ep("a"))
	subs, _ := r.m.Push.ListByUsers(ctx, []string{"u_ana"})
	if len(subs) != 1 || subs[0].P256dhEnc == b64(65) || subs[0].AuthEnc == b64(16) {
		t.Fatalf("keys stored in the clear: %+v", subs)
	}
	// Only the owner can unsubscribe a device.
	_ = r.svc.Unsubscribe(ctx, r.ben, ep("a"))
	if subs, _ := r.m.Push.ListByUsers(ctx, []string{"u_ana"}); len(subs) != 1 {
		t.Fatal("another user removed Ana's device")
	}
	_ = r.svc.Unsubscribe(ctx, r.ana, ep("a"))
	if subs, _ := r.m.Push.ListByUsers(ctx, []string{"u_ana"}); len(subs) != 0 {
		t.Fatal("not removed")
	}
}

func TestNotifyCapsDevicesPerUser(t *testing.T) {
	r := newNotifyRig(t)
	for i := range maxSubsPerUser + 3 {
		r.subscribe(t, r.ana, ep(strings.Repeat("d", i+1)))
		r.now = r.now.Add(time.Second)
	}
	subs, _ := r.m.Push.ListByUsers(context.Background(), []string{"u_ana"})
	if len(subs) != maxSubsPerUser || subs[0].Endpoint != ep("dddd") {
		t.Fatalf("cap: %d, oldest %s", len(subs), subs[0].Endpoint)
	}
}

func TestItemPhrase(t *testing.T) {
	cases := []struct {
		names []string
		count int
		want  string
	}{
		{[]string{"milk"}, 1, "milk"},
		{[]string{"milk", "eggs"}, 2, "milk and eggs"},
		{[]string{"milk", "eggs", "jam"}, 3, "milk, eggs and 1 more"},
		{[]string{"milk", "eggs", "jam", "tea", "rice"}, 9, "milk, eggs and 7 more"},
		{nil, 3, "3 items"},
	}
	for _, c := range cases {
		if got := itemPhrase(c.names, c.count); got != c.want {
			t.Errorf("%v %d: %q, want %q", c.names, c.count, got, c.want)
		}
	}
}

func TestTripRemindersOncePerStart(t *testing.T) {
	r := newNotifyRig(t)
	ctx := context.Background()
	r.subscribe(t, r.ana, ep("ana"))
	r.subscribe(t, r.ben, ep("ben"))
	r.subscribe(t, r.cy, ep("cy"))
	day, at, flight := "2026-10-19", "10:30", "2026-10-20T08:00"
	tomorrow := "2026-10-25"
	if err := r.m.Trips.Insert(ctx, &models.Trip{
		TripID: "trip_1", RoomID: r.roomID, Version: 1,
		TripFields: models.TripFields{Title: "Lisbon", TZ: "UTC", EndDate: &tomorrow, Travellers: []string{"u_ana", "u_ben"}},
		Todos: []models.TripTodo{
			{TodoID: "td_1", Title: "Tram 28", Day: &day, StartTime: &at},
			{TodoID: "td_2", Title: "Untimed", Day: &day},
		},
		Bookings: []models.Booking{{BookingID: "bk_1", Title: "Flight home", StartsAt: &flight}},
	}); err != nil {
		t.Fatal(err)
	}
	// 09:00: the 10:30 to-do is 90 minutes away (not yet); the flight is within a day.
	if n, _ := r.svc.RemindOnce(ctx); n != 1 {
		t.Fatalf("queued %d", n)
	}
	r.now = r.now.Add(45 * time.Minute) // 09:45: the to-do is due too
	if n, _ := r.svc.RemindOnce(ctx); n != 2 {
		t.Fatalf("queued %d", n)
	}
	r.dispatch(t)
	_, _ = r.svc.RemindOnce(ctx) // a later pass must not send them again
	r.dispatch(t)
	bodies := map[string]int{}
	for _, s := range r.send.sent {
		if s.Endpoint == ep("cy") {
			t.Fatal("a non-traveller got a trip reminder")
		}
		if s.Msg.Title != "Lisbon" || s.Msg.URL != "/app/trips/trip_1" {
			t.Fatalf("message: %+v", s.Msg)
		}
		bodies[s.Msg.Body]++
	}
	if bodies["Tram 28 at 10:30"] != 2 || bodies["Flight home · Tue 20 Oct, 08:00"] != 2 || len(bodies) != 2 {
		t.Fatalf("bodies: %v", bodies)
	}
}

// item makes an item on the rig's list (as Ben, so no add notification reaches Ben).
func (r *notifyRig) item(t *testing.T, name string) *models.ListItem {
	t.Helper()
	it, err := r.lists.CreateItem(context.Background(), r.ben, r.roomID, r.listID, name, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	return it
}

func (r *notifyRig) check(t *testing.T, u *models.User, it *models.ListItem, done bool) {
	t.Helper()
	if _, err := r.lists.UpdateItem(context.Background(), u, r.roomID, r.listID, it.ItemID, nil, &done, nil, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
}

// sentTo returns the bodies pushed to one endpoint since the last call, and forgets them.
func (r *notifyRig) sentTo(endpoint string) []string {
	var out []string
	for _, s := range r.send.sent {
		if s.Endpoint == endpoint {
			out = append(out, s.Msg.Body)
		}
	}
	r.send.sent = nil
	return out
}

func TestNotifyCheckOffsOncePerRun(t *testing.T) {
	r := newNotifyRig(t)
	r.subscribe(t, r.ana, ep("ana"))
	r.subscribe(t, r.ben, ep("ben"))
	milk, eggs, bread, jam, tea, rice := r.item(t, "Milk"), r.item(t, "Eggs"), r.item(t, "Bread"), r.item(t, "Jam"), r.item(t, "Tea"), r.item(t, "Rice")
	r.now = r.now.Add(defaultCoalesce)
	r.dispatch(t) // Ben's adds go to Ana; not what this test is about
	r.sentTo("")

	// Ana starts shopping: an uncheck and recheck of Milk counts once.
	r.check(t, r.ana, milk, true)
	r.check(t, r.ana, eggs, true)
	r.check(t, r.ana, milk, false)
	r.check(t, r.ana, milk, true)
	r.check(t, r.ana, bread, true)
	r.now = r.now.Add(defaultCoalesce)
	r.dispatch(t)
	var tag string
	var bodies []string
	for _, s := range r.send.sent {
		if s.Endpoint == ep("ben") {
			tag = s.Msg.Tag
			bodies = append(bodies, s.Msg.Body)
		}
	}
	if len(bodies) != 1 || bodies[0] != "Ana is checking off Milk, Eggs and 1 more" {
		t.Fatalf("first run: %v", bodies)
	}
	if got := r.sentTo(ep("ana")); len(got) != 0 {
		t.Fatalf("Ana heard about her own check-offs: %v", got)
	}
	r.check(t, r.ana, jam, true) // keeps the run open; Ben's copy was taken above
	r.now = r.now.Add(time.Hour)
	if n := r.dispatch(t); n != 0 {
		t.Fatalf("a check-off mid-run notified again: %d", n)
	}
	if tag != "list:"+r.listID+":checks" {
		t.Fatalf("tag %q", tag)
	}

	// Still the same run: under two quiet hours since the last check-off (Jam).
	r.now = r.now.Add(59 * time.Minute)
	r.check(t, r.ana, tea, true)
	r.now = r.now.Add(defaultCoalesce)
	if n := r.dispatch(t); n != 0 {
		t.Fatalf("a check-off in the same run notified: %d", n)
	}

	// Over two quiet hours later: a new run.
	r.now = r.now.Add(checkRunGap + time.Minute)
	r.check(t, r.ana, rice, true)
	r.now = r.now.Add(defaultCoalesce)
	r.dispatch(t)
	if got := r.sentTo(ep("ben")); len(got) != 1 || got[0] != "Ana is checking off Rice" {
		t.Fatalf("new run: %v", got)
	}
}

func TestNotifyCheckOffWording(t *testing.T) {
	r := newNotifyRig(t)
	r.subscribe(t, r.ben, ep("ben"))
	items := []*models.ListItem{r.item(t, "Milk"), r.item(t, "Eggs"), r.item(t, "Bread"), r.item(t, "Jam")}
	r.now = r.now.Add(defaultCoalesce)
	r.dispatch(t)
	r.sentTo("")
	for _, it := range items {
		r.check(t, r.ana, it, true)
	}
	r.now = r.now.Add(defaultCoalesce)
	r.dispatch(t)
	if got := r.sentTo(ep("ben")); len(got) != 1 || got[0] != "Ana is checking off Milk, Eggs and 2 more" {
		t.Fatalf("wording: %v", got)
	}
}

func TestNotifyListActivitySwitchCoversCheckOffs(t *testing.T) {
	r := newNotifyRig(t)
	ctx := context.Background()
	r.subscribe(t, r.ben, ep("ben"))
	milk := r.item(t, "Milk")
	off := false
	if _, err := r.svc.SetPrefs(ctx, r.ben, NotifyPrefsPatch{ItemAdds: &off}); err != nil {
		t.Fatal(err)
	}
	r.check(t, r.ana, milk, true)
	r.now = r.now.Add(defaultCoalesce)
	if n := r.dispatch(t); n != 0 {
		t.Fatalf("List activity off, still notified: %d", n)
	}
}

func TestNotifyOnlyLoggedInDevices(t *testing.T) {
	r := newNotifyRig(t)
	ctx := context.Background()
	r.subscribe(t, r.ben, ep("ben-old"))
	// Ben logs in on a new phone: the key rotates, which signs the old phone out.
	r.now = r.now.Add(time.Minute)
	exp := r.now.Add(30 * 24 * time.Hour)
	if err := r.m.Users.SetAPIKey(ctx, "u_ben", "hash", "lookup-2", &exp, r.now); err != nil {
		t.Fatal(err)
	}
	r.now = r.now.Add(time.Second)
	r.subscribe(t, r.ben, ep("ben-new"))
	_, _ = r.lists.CreateItem(ctx, r.ana, r.roomID, r.listID, "Milk", "", "", "")
	r.now = r.now.Add(defaultCoalesce)
	r.dispatch(t)
	if old := r.sentTo(ep("ben-old")); len(old) != 0 {
		t.Fatal("a signed-out phone was notified")
	}
	if subs, _ := r.m.Push.ListByUsers(ctx, []string{"u_ben"}); len(subs) != 2 {
		t.Fatalf("the stale phone must be skipped, not deleted: %d devices", len(subs))
	}

	// The key expires: nobody is signed in, nothing is sent.
	expired := r.now.Add(-time.Minute)
	if err := r.m.Users.SetAPIKey(ctx, "u_ben", "hash", "lookup-3", &expired, r.now.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	_, _ = r.lists.CreateItem(ctx, r.ana, r.roomID, r.listID, "Eggs", "", "", "")
	r.now = r.now.Add(defaultCoalesce)
	if n := r.dispatch(t); n != 0 {
		t.Fatalf("sent with an expired key: %d", n)
	}
}

func TestNotifyRefreshedDeviceCountsAgain(t *testing.T) {
	r := newNotifyRig(t)
	ctx := context.Background()
	r.subscribe(t, r.ben, ep("ben"))
	r.now = r.now.Add(time.Minute)
	if err := r.m.Users.SetAPIKey(ctx, "u_ben", "hash", "lookup-2", nil, r.now); err != nil {
		t.Fatal(err)
	}
	// The app starts on that phone with the new key and refreshes its subscription.
	r.now = r.now.Add(time.Second)
	r.subscribe(t, r.ben, ep("ben"))
	_, _ = r.lists.CreateItem(ctx, r.ana, r.roomID, r.listID, "Milk", "", "", "")
	r.now = r.now.Add(defaultCoalesce)
	if n := r.dispatch(t); n != 1 {
		t.Fatalf("refreshed phone skipped: %d", n)
	}
}

func TestNotifyFollowsSessions(t *testing.T) {
	r := newNotifyRig(t)
	ctx := context.Background()
	r.svc.UseSessions(r.m.Sessions)
	live := &models.Session{SessionID: "ses_live", UserID: "u_ben", KeyLookup: "l1", CreatedAt: r.now, ExpiresAt: r.now.Add(time.Hour)}
	old := &models.Session{SessionID: "ses_old", UserID: "u_ben", KeyLookup: "l2", CreatedAt: r.now, ExpiresAt: r.now.Add(time.Minute)}
	_ = r.m.Sessions.Insert(ctx, live)
	_ = r.m.Sessions.Insert(ctx, old)
	for name, sid := range map[string]string{"ben-live": "ses_live", "ben-old": "ses_old", "ben-gone": "ses_gone", "ben-legacy": ""} {
		if err := r.svc.Subscribe(ctx, r.ben, SubscribeInput{SessionID: sid, Endpoint: ep(name), P256dh: b64(65), Auth: b64(16)}); err != nil {
			t.Fatal(err)
		}
	}
	_, _ = r.lists.CreateItem(ctx, r.ana, r.roomID, r.listID, "Milk", "", "", "")
	r.now = r.now.Add(defaultCoalesce) // past ses_old's expiry
	r.dispatch(t)
	got := map[string]bool{}
	for _, s := range r.send.sent {
		got[s.Endpoint] = true
	}
	if !got[ep("ben-live")] || !got[ep("ben-legacy")] || got[ep("ben-old")] || got[ep("ben-gone")] {
		t.Fatalf("sent to %v", got)
	}
}
