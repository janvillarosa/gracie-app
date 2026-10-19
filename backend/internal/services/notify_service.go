package services

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/rand"
	"slices"
	"strings"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/crypto"
	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/push"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
	"github.com/janvillarosa/gracie-app/backend/pkg/ids"
)

const (
	// defaultCoalesce is how long an add waits for more adds before it is sent.
	defaultCoalesce = 90 * time.Second
	// pushLease outlives one job's sends; a lapsed lease means the instance died mid-send.
	pushLease = 2 * time.Minute
	// pushMaxAttempts bounds retries of a job the push services keep refusing.
	pushMaxAttempts = 5
	// pushJobBatch bounds the jobs one dispatch pass sends.
	pushJobBatch = 100
	// pushKeep is how long a job is kept after it is done (it dedupes trip reminders).
	pushKeep = 7 * 24 * time.Hour
	// maxSubsPerUser caps one person's devices; the oldest goes when a new one subscribes.
	maxSubsPerUser = 10
	// checkRunGap ends a run of check-offs: after this long with none, the next one is a new run
	// and notifies again.
	checkRunGap = 2 * time.Hour
)

// ItemNotifier hears about adds to and check-offs on a list. ListService calls it after the write;
// it never fails or slows the write (it only writes to the outbox).
type ItemNotifier interface {
	ItemAdded(ctx context.Context, actorID string, it *models.ListItem)
	SystemItemAdded(ctx context.Context, source string, it *models.ListItem)
	ItemChecked(ctx context.Context, actorID string, it *models.ListItem)
}

// NotifyService owns push notifications: devices, each person's switches, the outbox and the
// dispatcher that sends it.
//
// Consistency: the outbox write follows the domain write and is not in its transaction. A crash
// between them loses a notification, never the item. That trade-off is deliberate.
type NotifyService struct {
	users    store.UserRepository
	rooms    store.RoomRepository
	lists    store.ListRepository
	trips    store.TripRepository
	subs     store.PushSubscriptionRepository
	jobs     store.PushJobRepository
	sender   push.Sender
	pubKey   string
	encKey   []byte
	coalesce time.Duration
	now      func() time.Time
}

func NewNotifyService(users store.UserRepository, rooms store.RoomRepository, lists store.ListRepository,
	subs store.PushSubscriptionRepository, jobs store.PushJobRepository, sender push.Sender, publicKey string, encKey []byte) *NotifyService {
	return &NotifyService{users: users, rooms: rooms, lists: lists, subs: subs, jobs: jobs, sender: sender,
		pubKey: publicKey, encKey: encKey, coalesce: defaultCoalesce, now: time.Now}
}

// WithClock replaces the clock (tests).
func (s *NotifyService) WithClock(now func() time.Time) *NotifyService { s.now = now; return s }

// UseCoalesce sets how long adds wait to merge (zero keeps the default).
func (s *NotifyService) UseCoalesce(d time.Duration) {
	if d > 0 {
		s.coalesce = d
	}
}

// PublicKey is the VAPID key browsers subscribe with.
func (s *NotifyService) PublicKey() string { return s.pubKey }

// SubscribeInput is one browser's PushSubscription.toJSON().
type SubscribeInput struct {
	Endpoint  string
	P256dh    string
	Auth      string
	UserAgent string
}

// Subscribe stores (or refreshes) the caller's device. Only known push services are accepted.
func (s *NotifyService) Subscribe(ctx context.Context, u *models.User, in SubscribeInput) error {
	if err := push.ValidateEndpoint(in.Endpoint); err != nil {
		return derr.ErrBadRequest
	}
	// p256dh is an uncompressed P-256 point (65 bytes), auth a 16-byte secret.
	if !b64Len(in.P256dh, 65) || !b64Len(in.Auth, 16) {
		return derr.ErrBadRequest
	}
	p, err := crypto.Encrypt(s.encKey, []byte(in.P256dh))
	if err != nil {
		return err
	}
	a, err := crypto.Encrypt(s.encKey, []byte(in.Auth))
	if err != nil {
		return err
	}
	ua := in.UserAgent
	if len(ua) > 256 {
		ua = ua[:256]
	}
	now := s.now().UTC()
	if err := s.subs.Upsert(ctx, &models.PushSubscription{
		SubID: ids.NewID("psub"), UserID: u.UserID, Endpoint: in.Endpoint, P256dhEnc: p, AuthEnc: a,
		UserAgent: ua, CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		return err
	}
	mine, err := s.subs.ListByUsers(ctx, []string{u.UserID})
	if err != nil {
		return err
	}
	for i := 0; len(mine)-i > maxSubsPerUser; i++ {
		_ = s.subs.DeleteForUser(ctx, u.UserID, mine[i].Endpoint)
	}
	return nil
}

func b64Len(s string, n int) bool {
	b, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(s, "="))
	return err == nil && len(b) == n
}

// Unsubscribe removes the caller's device (signing out, or turning notifications off).
func (s *NotifyService) Unsubscribe(ctx context.Context, u *models.User, endpoint string) error {
	if endpoint == "" {
		return derr.ErrBadRequest
	}
	return s.subs.DeleteForUser(ctx, u.UserID, endpoint)
}

// ForgetUser removes every device of a deleted account.
func (s *NotifyService) ForgetUser(ctx context.Context, userID string) {
	if err := s.subs.DeleteByUser(ctx, userID); err != nil {
		log.Printf("push: forget user %s: %v", userID, err)
	}
}

// NotifyPrefs are a person's switches. ItemAdds is "List activity": adds and check-offs.
type NotifyPrefs struct {
	ItemAdds      bool `json:"itemAdds"`
	Autopilot     bool `json:"autopilot"`
	TripReminders bool `json:"tripReminders"`
}

// NotifyPrefsPatch changes only the fields that are set.
type NotifyPrefsPatch struct {
	ItemAdds      *bool `json:"itemAdds,omitempty"`
	Autopilot     *bool `json:"autopilot,omitempty"`
	TripReminders *bool `json:"tripReminders,omitempty"`
}

func (s *NotifyService) Prefs(u *models.User) NotifyPrefs {
	return NotifyPrefs{
		ItemAdds:      u.Notifies(models.PushKindItemAdds),
		Autopilot:     u.Notifies(models.PushKindAutopilot),
		TripReminders: u.Notifies(models.PushKindTrip),
	}
}

func (s *NotifyService) SetPrefs(ctx context.Context, u *models.User, p NotifyPrefsPatch) (NotifyPrefs, error) {
	if p.ItemAdds == nil && p.Autopilot == nil && p.TripReminders == nil {
		return NotifyPrefs{}, derr.ErrBadRequest
	}
	prefs := models.UserPreferences{NotifyItemAdds: p.ItemAdds, NotifyAutopilot: p.Autopilot, NotifyTrips: p.TripReminders}
	if err := s.users.UpdatePreferences(ctx, u.UserID, prefs, s.now().UTC()); err != nil {
		return NotifyPrefs{}, err
	}
	fresh, err := s.users.GetByID(ctx, u.UserID)
	if err != nil {
		return NotifyPrefs{}, err
	}
	return s.Prefs(fresh), nil
}

// ItemAdded queues "<actor> added <item> to <list>" for the rest of the house. Adds by the same
// person to the same list within the coalesce window merge into one notification.
func (s *NotifyService) ItemAdded(ctx context.Context, actorID string, it *models.ListItem) {
	s.enqueue(ctx, &models.PushJob{
		CoalesceKey: "add:" + it.RoomID + ":" + it.ListID + ":" + actorID, Kind: models.PushKindItemAdds,
		RoomID: it.RoomID, ActorID: actorID, ListID: it.ListID, Names: []string{it.Description}, Count: 1,
	}, false)
}

// SystemItemAdded queues "Butler added <items>" for the whole house; one tick's adds merge.
func (s *NotifyService) SystemItemAdded(ctx context.Context, source string, it *models.ListItem) {
	if source != SourceAutopilot {
		return
	}
	s.enqueue(ctx, &models.PushJob{
		CoalesceKey: "autopilot:" + it.RoomID + ":" + it.ListID, Kind: models.PushKindAutopilot,
		RoomID: it.RoomID, ActorID: ActorAutopilot, ListID: it.ListID, Names: []string{it.Description}, Count: 1,
	}, false)
}

// ItemChecked queues "<actor> is checking off <items>" for the rest of the house, once per run: a
// run is the person's check-offs on the list with no quiet gap over checkRunGap. The check-offs in
// the first merge window are named; the rest of the run is silent.
func (s *NotifyService) ItemChecked(ctx context.Context, actorID string, it *models.ListItem) {
	now := s.now().UTC()
	j := &models.PushJob{
		CoalesceKey: "check:" + it.RoomID + ":" + it.ListID + ":" + actorID, Kind: models.PushKindItemChecks,
		RoomID: it.RoomID, ActorID: actorID, ListID: it.ListID, URL: "/app/lists/" + it.ListID,
		Names: []string{it.Description}, Count: 1, SendAfter: now.Add(s.coalesce), CreatedAt: now, ExpireAt: now.Add(pushKeep),
	}
	if err := s.jobs.EnqueueRun(ctx, j, checkRunGap, now); err != nil {
		log.Printf("push: enqueue %s: %v", j.CoalesceKey, err)
	}
}

func (s *NotifyService) enqueue(ctx context.Context, j *models.PushJob, once bool) {
	now := s.now().UTC()
	if j.URL == "" && j.ListID != "" {
		j.URL = "/app/lists/" + j.ListID
	}
	if j.SendAfter.IsZero() {
		j.SendAfter = now.Add(s.coalesce)
	}
	j.CreatedAt, j.ExpireAt = now, now.Add(pushKeep)
	if err := s.jobs.Enqueue(ctx, j, once); err != nil {
		log.Printf("push: enqueue %s: %v", j.CoalesceKey, err)
	}
}

// DispatchOnce sends every due job and returns how many messages the push services accepted.
// Claims are atomic, so any number of instances can dispatch at once.
func (s *NotifyService) DispatchOnce(ctx context.Context) (int, error) {
	sent := 0
	for range pushJobBatch {
		now := s.now().UTC()
		j, err := s.jobs.Claim(ctx, now, pushLease)
		if err != nil {
			return sent, err
		}
		if j == nil {
			return sent, nil
		}
		n, retry := s.send(ctx, j)
		sent += n
		switch {
		case retry && j.Attempts < pushMaxAttempts:
			backoff := time.Duration(30<<j.Attempts) * time.Second
			err = s.jobs.Retry(ctx, j.JobID, now.Add(backoff))
		default:
			err = s.jobs.Finish(ctx, j.JobID, now.Add(pushKeep))
		}
		if err != nil {
			log.Printf("push: settle job %s: %v", j.JobID, err)
		}
	}
	return sent, nil
}

// send delivers one job to every device of its recipients. It reports whether to retry: a lookup
// failed, or a push service asked for later. A retry may reach a device again; the tag makes the
// phone replace the first copy, so nobody sees it twice.
func (s *NotifyService) send(ctx context.Context, j *models.PushJob) (int, bool) {
	room, err := s.rooms.GetByID(ctx, j.RoomID)
	if err != nil {
		return 0, !errors.Is(err, derr.ErrNotFound) // a gone house needs no notification
	}
	msg, ok, err := s.message(ctx, j)
	if err != nil {
		return 0, true
	}
	if !ok {
		return 0, false
	}
	now := s.now().UTC()
	to := map[string]*models.User{}
	var ids []string
	for _, id := range room.MemberIDs {
		if id == j.ActorID || (len(j.Recipients) > 0 && !slices.Contains(j.Recipients, id)) {
			continue
		}
		u, err := s.users.GetByID(ctx, id)
		if err != nil || !u.Notifies(j.Kind) || !loggedIn(u, now) {
			continue
		}
		to[id] = u
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return 0, false
	}
	devices, err := s.subs.ListByUsers(ctx, ids)
	if err != nil {
		return 0, true
	}
	return s.deliver(ctx, currentDevices(devices, to), msg, push.Topic(j.JobID))
}

// loggedIn reports whether the user's key is still valid: an expired key means nobody is signed in.
func loggedIn(u *models.User, now time.Time) bool {
	return u.APIKeyExpiresAt == nil || now.Before(*u.APIKeyExpiresAt)
}

// currentDevices keeps the devices that belong to their user's current login. Logging in rotates
// the key, which signs out every other device; such a device was last refreshed (the app does on
// every start) before the new key was issued. It is skipped, not deleted: the dispatcher may have
// read the user just before a login, so deleting could drop the new device. Stale rows go when the
// app reopens (it signs out and unsubscribes) or when the push service answers 404/410.
func currentDevices(devices []models.PushSubscription, users map[string]*models.User) []models.PushSubscription {
	out := devices[:0:0]
	for _, d := range devices {
		u := users[d.UserID]
		if u == nil || (u.APIKeyIssuedAt != nil && d.UpdatedAt.Before(*u.APIKeyIssuedAt)) {
			continue
		}
		out = append(out, d)
	}
	return out
}

// DeviceResult is how one device took a message.
type DeviceResult struct {
	Service string // Apple, Google, ...
	Status  int    // the push service's HTTP status; 0 when it could not be reached
	Err     string
	Removed bool // the device was dropped (the push service said it is gone, or its keys were unreadable)
}

func (r DeviceResult) ok() bool { return r.Err == "" && r.Status >= 200 && r.Status < 300 }

// Describe words the result for a person: "Apple: refused our key (403)".
func (r DeviceResult) Describe() string {
	switch {
	case r.ok():
		return r.Service + ": ok"
	case r.Err != "" && r.Status == 0:
		return r.Service + ": " + r.Err
	case r.Status == 401 || r.Status == 403:
		return fmt.Sprintf("%s: refused our key (%d)", r.Service, r.Status)
	case push.Gone(r.Status):
		return fmt.Sprintf("%s: subscription expired, removed (%d)", r.Service, r.Status)
	}
	return fmt.Sprintf("%s: status %d", r.Service, r.Status)
}

// deliver pushes msg to every device and reports how many the push services accepted and whether
// any asked to try later. Devices the push service says are gone are removed.
func (s *NotifyService) deliver(ctx context.Context, devices []models.PushSubscription, msg push.Message, topic string) (int, bool) {
	sent, retry := 0, false
	for _, r := range s.deliverEach(ctx, devices, msg, topic) {
		switch {
		case r.ok():
			sent++
		case r.Removed:
		case r.Status == 0 || push.Retryable(r.Status):
			retry = true
		}
	}
	return sent, retry
}

// deliverEach sends to every device and reports each one's result.
func (s *NotifyService) deliverEach(ctx context.Context, devices []models.PushSubscription, msg push.Message, topic string) []DeviceResult {
	payload, _ := json.Marshal(msg)
	out := make([]DeviceResult, 0, len(devices))
	for _, d := range devices {
		r := DeviceResult{Service: push.ServiceName(d.Endpoint)}
		p, err1 := crypto.Decrypt(s.encKey, d.P256dhEnc)
		a, err2 := crypto.Decrypt(s.encKey, d.AuthEnc)
		if err1 != nil || err2 != nil {
			log.Printf("push: device %s: keys unreadable, removing", d.SubID)
			_ = s.subs.DeleteEndpoint(ctx, d.Endpoint)
			r.Err, r.Removed = "keys unreadable, removed", true
			out = append(out, r)
			continue
		}
		status, err := s.sender.Send(ctx, push.Subscription{Endpoint: d.Endpoint, P256dh: string(p), Auth: string(a)},
			payload, push.Options{Topic: topic, TTL: 24 * time.Hour})
		r.Status = status
		switch {
		case err != nil:
			log.Printf("push: send %s to %s device %s: %v", topic, r.Service, d.SubID, err)
			r.Err = "could not reach the push service"
		case push.Gone(status):
			log.Printf("push: %s device %s is gone (%d), removed", r.Service, d.SubID, status)
			_ = s.subs.DeleteEndpoint(ctx, d.Endpoint)
			r.Removed = true
		case status >= 200 && status < 300:
			_ = s.subs.MarkOK(ctx, d.Endpoint, s.now().UTC())
		case !push.Retryable(status):
			log.Printf("push: send %s to %s device %s: status %d", topic, r.Service, d.SubID, status)
		}
		out = append(out, r)
	}
	return out
}

// message words the job. ok is false when there is nothing to say any more (the list is gone).
func (s *NotifyService) message(ctx context.Context, j *models.PushJob) (push.Message, bool, error) {
	msg := push.Message{Title: j.Title, Body: j.Body, URL: j.URL, Tag: j.CoalesceKey}
	if j.Kind == models.PushKindTrip {
		return msg, true, nil
	}
	l, err := s.lists.GetByID(ctx, j.ListID)
	if errors.Is(err, derr.ErrNotFound) || (err == nil && l.IsDeleted) {
		return msg, false, nil
	}
	if err != nil {
		return msg, false, err
	}
	who, verb := "Butler", "added"
	if j.Kind != models.PushKindAutopilot {
		who = "Someone"
		if u, err := s.users.GetByID(ctx, j.ActorID); err == nil && u.Name != "" {
			who = u.Name
		}
	}
	// One notification per list and kind on the phone: a newer one replaces it, and a check-off
	// never hides an unread add.
	msg.Tag = "list:" + j.ListID
	if j.Kind == models.PushKindItemChecks {
		verb = "is checking off"
		msg.Tag += ":checks"
	}
	msg.Title = l.Name
	msg.Body = who + " " + verb + " " + itemPhrase(j.Names, j.Count)
	return msg, true, nil
}

// itemPhrase names at most two items: "milk", "milk and eggs", "milk, eggs and 3 more".
func itemPhrase(names []string, count int) string {
	if len(names) > 2 {
		names = names[:2]
	}
	more := max(count-len(names), 0)
	switch {
	case len(names) == 0:
		return fmt.Sprintf("%d items", max(count, 1))
	case more == 0 && len(names) == 1:
		return names[0]
	case more == 0:
		return names[0] + " and " + names[1]
	default:
		return strings.Join(names, ", ") + fmt.Sprintf(" and %d more", more)
	}
}

// RunDispatch sends due jobs on a jittered timer until ctx ends.
func (s *NotifyService) RunDispatch(ctx context.Context, every time.Duration) {
	for {
		if _, err := s.DispatchOnce(ctx); err != nil && ctx.Err() == nil {
			log.Printf("push: dispatch: %v", err)
		}
		wait := every + time.Duration(rand.Int63n(int64(every/5)+1))
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}
