package services

import (
	"context"
	"strings"
	"sync"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/parse"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
)

// BackfillActor is the actor on events whose real actor was never recorded and cannot be
// guessed (a house with several members). The "system:" prefix keeps them out of every
// person's profile and per-member totals while still counting toward house history.
const BackfillActor = "system:backfill"

// BackfillDirectory answers "who", "which zone" for records that predate analytics. It is
// loaded lazily, once per house filter, from the read-only backfill reader.
type BackfillDirectory struct {
	r store.BackfillReader

	mu      sync.Mutex
	loaded  bool
	loadFor string
	tz      map[string]string   // user -> last-seen IANA zone
	members map[string][]string // house -> member ids
}

func NewBackfillDirectory(r store.BackfillReader) *BackfillDirectory {
	return &BackfillDirectory{r: r}
}

func (d *BackfillDirectory) ensure(ctx context.Context, roomID string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.loaded && d.loadFor == roomID {
		return nil
	}
	tz := map[string]string{}
	if err := d.r.EachUser(ctx, roomID, func(u models.User) error {
		tz[u.UserID] = u.TZ
		return nil
	}); err != nil {
		return err
	}
	members := map[string][]string{}
	if err := d.r.EachRoom(ctx, roomID, func(rm models.Room) error {
		members[rm.RoomID] = rm.MemberIDs
		return nil
	}); err != nil {
		return err
	}
	d.tz, d.members, d.loaded, d.loadFor = tz, members, true, roomID
	return nil
}

// actorFor attributes an event whose actor was not recorded: the house's only member, else
// the system actor. Better no personal history than the wrong person's.
func (d *BackfillDirectory) actorFor(roomID string) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	if m := d.members[roomID]; len(m) == 1 {
		return m[0]
	}
	return BackfillActor
}

// TZ is the analytics.BackfillEnv resolver: a person's own last-seen zone, or for the
// system actor the zone every member of the house agrees on. "" means unknown (UTC).
func (d *BackfillDirectory) TZ(_ context.Context, actorID, roomID string) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	if !strings.HasPrefix(actorID, "system:") {
		return d.tz[actorID]
	}
	agreed := ""
	for _, id := range d.members[roomID] {
		z := d.tz[id]
		if z == "" || (agreed != "" && z != agreed) {
			return ""
		}
		agreed = z
	}
	return agreed
}

// Sources are the list-side backfill sources: accounts, houses, lists and items. Trips live
// in package trips and are added by the caller.
func (d *BackfillDirectory) Sources() []analytics.BackfillSource {
	return []analytics.BackfillSource{userBackfill{d}, houseBackfill{d}, listBackfill{d}, itemBackfill{d}}
}

// --- users ---

type userBackfill struct{ d *BackfillDirectory }

func (userBackfill) Name() string { return "users" }

func (s userBackfill) Each(ctx context.Context, env analytics.BackfillEnv, emit func(analytics.Event, string) error) error {
	if err := s.d.ensure(ctx, env.RoomID); err != nil {
		return err
	}
	return s.d.r.EachUser(ctx, env.RoomID, func(u models.User) error {
		roomID := ""
		if u.RoomID != nil {
			roomID = *u.RoomID
		}
		return emit(deriveUserSignedUp(u, roomID), "")
	})
}

func deriveUserSignedUp(u models.User, roomID string) analytics.Event {
	return analytics.Event{
		Name: "user.signed_up", ActorID: u.UserID, RoomID: roomID, OccurredAt: u.CreatedAt,
		Subject: analytics.Ref{Type: "user", ID: u.UserID},
	}
}

// --- houses ---

type houseBackfill struct{ d *BackfillDirectory }

func (houseBackfill) Name() string { return "houses" }

func (s houseBackfill) Each(ctx context.Context, env analytics.BackfillEnv, emit func(analytics.Event, string) error) error {
	if err := s.d.ensure(ctx, env.RoomID); err != nil {
		return err
	}
	return s.d.r.EachRoom(ctx, env.RoomID, func(rm models.Room) error {
		return emit(deriveHouseCreated(rm, s.d.actorFor(rm.RoomID)), "")
	})
}

func deriveHouseCreated(rm models.Room, actor string) analytics.Event {
	return analytics.Event{
		Name: "house.created", ActorID: actor, RoomID: rm.RoomID, OccurredAt: rm.CreatedAt,
		Subject: analytics.Ref{Type: "house", ID: rm.RoomID},
	}
}

// --- lists ---

type listBackfill struct{ d *BackfillDirectory }

func (listBackfill) Name() string { return "lists" }

func (s listBackfill) Each(ctx context.Context, env analytics.BackfillEnv, emit func(analytics.Event, string) error) error {
	if err := s.d.ensure(ctx, env.RoomID); err != nil {
		return err
	}
	return s.d.r.EachList(ctx, env.RoomID, func(l models.List) error {
		return emit(deriveListCreated(l, s.d.actorFor(l.RoomID)), "")
	})
}

func deriveListCreated(l models.List, actor string) analytics.Event {
	return analytics.Event{
		Name: "list.created", ActorID: actor, RoomID: l.RoomID, OccurredAt: l.CreatedAt,
		Subject: listRef(l.ListID),
	}
}

// --- items ---

type itemBackfill struct{ d *BackfillDirectory }

func (itemBackfill) Name() string { return "items" }

func (s itemBackfill) Each(ctx context.Context, env analytics.BackfillEnv, emit func(analytics.Event, string) error) error {
	if err := s.d.ensure(ctx, env.RoomID); err != nil {
		return err
	}
	return s.d.r.EachItem(ctx, env.RoomID, func(it models.ListItem) error {
		evs, skips := deriveItemEvents(it, s.d.actorFor(it.RoomID))
		for _, r := range skips {
			env.Skip(r)
		}
		for _, ev := range evs {
			if err := emit(ev, ""); err != nil {
				return err
			}
		}
		return nil
	})
}

// deriveItemEvents returns the events an item implies, in the same shape ListService.emitItem
// produces, plus the reasons for anything left out. unknownActor is used where the item
// recorded nobody.
//
// An item carrying created_by was created by instrumented code, so its item.added already
// exists live; the same goes for completed_at and item.checked.
//
// Pre-analytics items have no completion time, so updated_at stands in for it: for a
// still-checked item that is roughly when it was checked, for an archived one it is when
// the list was cleared.
func deriveItemEvents(it models.ListItem, unknownActor string) (evs []analytics.Event, skips []string) {
	key := parse.NormalizeKey(it.Description)
	if key == "" {
		return nil, []string{analytics.SkipEmptyKey}
	}
	mk := func(name, actor string) analytics.Event {
		return analytics.Event{
			Name: name, ActorID: actor, RoomID: it.RoomID,
			Subject: analytics.Ref{Type: "item", ID: it.ItemID}, Container: ref(listRef(it.ListID)),
			Key: key, Category: it.Category,
		}
	}
	if it.CreatedBy != "" {
		skips = append(skips, analytics.SkipLiveMarker)
	} else {
		ev := mk("item.added", unknownActor)
		ev.OccurredAt = it.CreatedAt
		evs = append(evs, ev)
	}
	if it.Completed || it.IsArchived {
		if it.CompletedAt != nil {
			skips = append(skips, analytics.SkipLiveMarker)
		} else {
			actor := it.CompletedBy
			if actor == "" {
				actor = unknownActor
			}
			ev := mk("item.checked", actor)
			ev.OccurredAt = it.UpdatedAt
			evs = append(evs, ev)
		}
	}
	return evs, skips
}
