# Trips API & Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend for Bauhouse Trips: an offline-first, house-scoped trip aggregate (todos, bookings, ideas) with an idempotent op-outbox write path, delta sync, a Photon places proxy and a linked packing List.

**Architecture:** One Mongo document per trip. All writes are client-generated ops applied by a pure Go `ApplyOp` and persisted with a compare-and-swap `ReplaceOne`. Idempotency uses per-device sequence numbers, conflicts use per-field clocks, deletes use tombstones, and sync returns per-entity deltas. Layering follows Lists: `models` → `store` (+ memstore, mongo) → `services` → `http/handlers` → `router`.

**Tech Stack:** Go 1.26, chi v5, mongo-driver v1.16.1, `github.com/ringsaturn/tzf` (offline tz lookup). Tests: stdlib `testing`, `httptest`, memstore fakes; Mongo tests behind the `integration` build tag.

**Spec:** `docs/superpowers/specs/2026-10-14-trips-api-persistence-design.md` (read it first — this plan implements it).

## Global Constraints

- All backend work is under `backend/`; module path is `github.com/janvillarosa/gracie-app/backend`. Run Go commands from `backend/`.
- Internal identifiers stay `gracie`; the API stays `/rooms/*` (UI calls a room a "House").
- Never trust a bare `go test ./...` for Mongo behavior — Mongo tests need `-tags=integration` (`make test-integration`).
- Errors are JSON `{"error": "<msg>"}`. Trip handlers use their **own** status mapper that defaults to **500** (do not reuse `statusFromErr` from `handlers/list.go`, which defaults to 400).
- IDs: `trip_<32hex>`, `ttd_<32hex>`, `tbk_<32hex>` (client-generated). `op_id` and `client_id` match `^[A-Za-z0-9_-]{1,64}$` (client IDs become Mongo map keys, so no `.` or `$`).
- Caps: 150 todos, 50 bookings per trip; todo/booking notes ≤ 2048 bytes; trip notes ≤ 16384 bytes; titles ≤ 120 (trip) / 200 (todo, booking) runes; confirmation code ≤ 64; ≤ 200 ops per batch and 1 MB body on `/ops`; ≤ 500 `known` entries and 64 KB body on `/sync`.
- Op format version is `v: 1`. Unknown op `v`, type, op field or patch field gives a per-op `rejected`/`unsupported`, never a failed batch.
- Time zones: wall-clock strings plus IANA zone names. `import _ "time/tzdata"` in the `trips` package, because alpine images have no zoneinfo.
- Commit after every task; end each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Run `make check` from the repo root before the final commit and after Tasks 2, 12, 15 and 17.
- Do not rename existing identifiers, and do not touch `frontend/`.

## Review Focus

Failure modes the spec implies that no single task's happy-path tests cover; each has a pinned test in the task named.

1. A response lost, then 1000+ ops by other devices, then the original batch replayed — must be `duplicate`, not double-applied (Task 6).
2. A phone with its clock hours ahead sends an edit — must not win forever (Task 5).
3. A tombstoned todo/booking/trip ID re-sent in a `create` — must not come back (Tasks 5, 6, 7).
4. Two devices insert at the exact same `order` — must end up distinct and stable (Task 6).
5. Patch that tries to set `room_id`, `version`, `acked` or `todos` — must be `unsupported` and change nothing (Task 5).
6. A trip whose room differs from the URL — must give `forbidden_or_unknown`, identical to an unknown trip (Task 10).
7. A joiner's solo-room trips and queued ops — must follow them into the new house (Task 12).
8. Places upstream down or slow — must degrade to `200` + `degraded:true`, never a 5xx (Task 16).

## File Structure

| Path | Responsibility |
|---|---|
| `internal/testutil/memstore/memstore.go` (modify) | `Repos` struct return from `Compose()`; add Trip/PlaceCache fakes |
| `internal/testutil/memstore/trips.go` (create) | `TripRepo`, `PlaceCacheRepo` in-memory fakes |
| `internal/http/router/router.go` (modify) | `Handlers` struct, trips/places routes, `Compress` |
| `internal/services/membership.go` (create) | shared `ensureRoomMembership` |
| `internal/models/trip.go` (create) | all Trip types, `Clone()`, op/result/delta types |
| `internal/trips/patch.go` (create) | `Opt[T]`, typed patches, `decodePatch` |
| `internal/trips/validate.go` (create) | enum/format validators, `ValidateEnvelope`, `DecodeOp` |
| `internal/trips/apply.go` (create) | pure `ApplyOp` and helpers |
| `internal/trips/delta.go` (create) | `DeltaSince`, `PruneTombstones` |
| `internal/store/repo.go` (modify) | `TripRepository`, `PlaceCacheRepository`, `TripStub` |
| `internal/store/mongo/trip_repo.go`, `place_cache_repo.go` (create) | Mongo implementations |
| `internal/services/trip_service.go` (create) | `ApplyOps`, `Sync`, `EnsurePackingList` |
| `internal/ratelimit/limiter.go` (create) | token-bucket limiter |
| `internal/services/places/*.go` (create) | `Geocoder`, `PhotonGeocoder`, `TZResolver`, `Service` |
| `internal/http/handlers/trip.go`, `places.go` (create) | handlers + trip status mapper |
| `internal/services/room_service.go`, `user_service.go` (modify) | trip cleanup + move-on-join |
| `internal/config/config.go`, `cmd/gracie-server/main.go`, `.env.example` | wiring + env |
| `backend/CLAUDE.md`, spec (modify) | docs |

---

### Task 1: Refactor `memstore.Compose()` to return a struct

Pure refactor, no behavior change. Do it in its own commit so the feature diff stays readable.

**Files:**
- Modify: `backend/internal/testutil/memstore/memstore.go:46-50`
- Modify (callers): `backend/internal/http/handlers/handlers_test.go:18`, `backend/internal/http/handlers/list_handlers_test.go:18`, `backend/internal/services/services_test.go:13`, `backend/internal/services/room_service_additional_test.go:11`, `backend/internal/services/auth_service_test.go:13`, `backend/internal/services/user_service_additional_test.go:13,56`, `backend/internal/services/list_service_test.go:14,84`

**Interfaces:**
- Produces: `memstore.Repos{Tx store.TxRunner; Users store.UserRepository; Rooms store.RoomRepository; Lists store.ListRepository; Items store.ListItemRepository}` and `memstore.Compose() Repos`. Tasks 9+ add `Trips` and `Places` fields.

- [ ] **Step 1: Change `Compose`**

Replace the function in `memstore.go`:

```go
// Repos bundles the in-memory repositories that share one Store.
type Repos struct {
	Tx    store.TxRunner
	Users store.UserRepository
	Rooms store.RoomRepository
	Lists store.ListRepository
	Items store.ListItemRepository
}

// Compose returns in-memory repos + a no-op Tx runner.
func Compose() Repos {
	st := NewStore()
	return Repos{Tx: Tx{}, Users: &UserRepo{st}, Rooms: &RoomRepo{st}, Lists: &ListRepo{st}, Items: &ListItemRepo{st}}
}
```

- [ ] **Step 2: Update each caller with the minimal rewrite**

Replace each `... := memstore.Compose()` line (use the exact variable names already on that line):

```go
// handlers_test.go:18 and list_handlers_test.go:18
m := memstore.Compose()
tx, usersRepo, roomsRepo, listsRepo, itemsRepo := m.Tx, m.Users, m.Rooms, m.Lists, m.Items

// services_test.go:13 and list_service_test.go:14, :84
m := memstore.Compose()
tx, users, rooms, lists, items := m.Tx, m.Users, m.Rooms, m.Lists, m.Items

// room_service_additional_test.go:11
m := memstore.Compose()
tx, users, rooms := m.Tx, m.Users, m.Rooms

// auth_service_test.go:13
users := memstore.Compose().Users

// user_service_additional_test.go:13 and :56
m := memstore.Compose()
tx, usersRepo, roomsRepo := m.Tx, m.Users, m.Rooms
```

If a variable is declared in a scope where `m` already exists, name it `repos` instead.

- [ ] **Step 3: Run the suite**

Run: `cd backend && go build ./... && go vet ./... && go test ./... -count=1`
Expected: PASS (no behavior change).

- [ ] **Step 4: Commit**

```bash
git add backend/internal
git commit -m "refactor(memstore): Compose returns a Repos struct

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Refactor `NewRouter` to take a `Handlers` struct, share membership check

**Files:**
- Modify: `backend/internal/http/router/router.go:14`
- Modify (callers): `backend/cmd/gracie-server/main.go:80`, `backend/internal/http/handlers/handlers_test.go:31`, `backend/internal/http/handlers/list_handlers_test.go:32`
- Create: `backend/internal/services/membership.go`
- Modify: `backend/internal/services/list_service.go:30-53`

**Interfaces:**
- Produces: `router.Handlers{Auth *handlers.AuthHandler; User *handlers.UserHandler; Room *handlers.RoomHandler; List *handlers.ListHandler}` (Tasks 15–16 add `Trip`, `Places`) and `router.NewRouter(userFinder authmw.UserFinder, h Handlers) http.Handler`.
- Produces: `func ensureRoomMembership(ctx context.Context, rooms store.RoomRepository, user *models.User, roomID string) error` in package `services`.

- [ ] **Step 1: Router signature**

In `router.go`, add above `NewRouter` and change the signature, replacing `authHandler.` / `userHandler.` / `roomHandler.` / `listHandler.` with `h.Auth.` / `h.User.` / `h.Room.` / `h.List.` throughout the body:

```go
// Handlers groups the HTTP handlers the router wires up.
type Handlers struct {
	Auth *handlers.AuthHandler
	User *handlers.UserHandler
	Room *handlers.RoomHandler
	List *handlers.ListHandler
}

func NewRouter(userFinder authmw.UserFinder, h Handlers) http.Handler {
```

- [ ] **Step 2: Update the three callers**

```go
// main.go:80
r := router.NewRouter(usersRepo, router.Handlers{Auth: authHandler, User: userHandler, Room: roomHandler, List: listHandler})
// handlers_test.go:31 and list_handlers_test.go:32
r := router.NewRouter(usersRepo, router.Handlers{Auth: ah, User: uh, Room: rh, List: lh})
```

- [ ] **Step 3: Extract the membership check**

Create `backend/internal/services/membership.go`:

```go
package services

import (
	"context"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
)

// ensureRoomMembership verifies the user belongs to roomID and the room lists them.
func ensureRoomMembership(ctx context.Context, rooms store.RoomRepository, user *models.User, roomID string) error {
	if user.RoomID == nil || *user.RoomID == "" || *user.RoomID != roomID {
		return derr.ErrForbidden
	}
	rm, err := rooms.GetByID(ctx, roomID)
	if err != nil {
		return err
	}
	for _, mid := range rm.MemberIDs {
		if mid == user.UserID {
			return nil
		}
	}
	return derr.ErrForbidden
}
```

In `list_service.go` replace the body of `ListService.ensureRoomMembership` (lines 30–53, keep the method) with:

```go
func (s *ListService) ensureRoomMembership(ctx context.Context, user *models.User, roomID string) error {
	return ensureRoomMembership(ctx, s.rooms, user, roomID)
}
```

Remove any now-unused imports.

- [ ] **Step 4: Verify and commit**

Run: `cd backend && go build ./... && go vet ./... && go test ./... -count=1` then, from repo root, `make check`.
Expected: PASS.

```bash
git add backend
git commit -m "refactor(router): NewRouter takes Handlers; share membership check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Trip models

**Files:**
- Create: `backend/internal/models/trip.go`
- Test: `backend/internal/models/trip_test.go`

**Interfaces:**
- Produces (used by every later task):
  - consts `OpApplied="applied"`, `OpDuplicate="duplicate"`, `OpConflicted="conflicted"`, `OpRejected="rejected"`, `OpRetry="retry"`; `CodeGone="gone"`, `CodeInvalid="invalid"`, `CodeCap="cap"`, `CodeForbiddenOrUnknown="forbidden_or_unknown"`, `CodeUnsupported="unsupported"`
  - `Place`, `TripTodo`, `Booking`, `Tombstone`, `TripFields`, `Trip`, `(*Trip).Clone() *Trip`, `Op`, `OpResult`, `TripDelta`, `RemovedTrip`

- [ ] **Step 1: Write the failing test**

`backend/internal/models/trip_test.go`:

```go
package models

import "testing"

func TestTripCloneIsDeep(t *testing.T) {
	day := "2026-11-01"
	orig := &Trip{
		TripID:  "trip_x",
		FieldAt: map[string]int64{"title": 1},
		Acked:   map[string]int64{"dev": 1},
		Todos:   []TripTodo{{TodoID: "ttd_1", Day: &day, FieldAt: map[string]int64{"title": 1}}},
		Bookings: []Booking{{BookingID: "tbk_1", FieldAt: map[string]int64{"kind": 1}}},
		Tombstones: []Tombstone{{ID: "ttd_0", V: 2}},
	}
	c := orig.Clone()
	c.FieldAt["title"] = 99
	c.Acked["dev"] = 99
	c.Todos[0].FieldAt["title"] = 99
	c.Todos[0].Title = "changed"
	c.Bookings[0].FieldAt["kind"] = 99
	c.Tombstones[0].V = 99
	if orig.FieldAt["title"] != 1 || orig.Acked["dev"] != 1 ||
		orig.Todos[0].FieldAt["title"] != 1 || orig.Todos[0].Title != "" ||
		orig.Bookings[0].FieldAt["kind"] != 1 || orig.Tombstones[0].V != 2 {
		t.Fatalf("Clone shared state with the original")
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && go test ./internal/models/ -run TestTripCloneIsDeep -count=1`
Expected: FAIL (undefined: Trip).

- [ ] **Step 3: Implement**

`backend/internal/models/trip.go`:

```go
package models

import (
	"encoding/json"
	"time"
)

// Per-op result statuses and rejection codes (see the Trips spec).
const (
	OpApplied    = "applied"
	OpDuplicate  = "duplicate"
	OpConflicted = "conflicted"
	OpRejected   = "rejected"
	OpRetry      = "retry"

	CodeGone               = "gone"
	CodeInvalid            = "invalid"
	CodeCap                = "cap"
	CodeForbiddenOrUnknown = "forbidden_or_unknown"
	CodeUnsupported        = "unsupported"
)

// Place is a self-contained snapshot of a location.
type Place struct {
	Name    string  `bson:"name" json:"name"`
	Address string  `bson:"address,omitempty" json:"address,omitempty"`
	Lat     float64 `bson:"lat" json:"lat"`
	Lng     float64 `bson:"lng" json:"lng"`
	TZ      string  `bson:"tz,omitempty" json:"tz,omitempty"`
	OSMRef  string  `bson:"osm_ref,omitempty" json:"osm_ref,omitempty"`
	Source  string  `bson:"source" json:"source"` // photon | pin | manual
}

// TripTodo is a checkbox item inside a trip. Day == nil means "Ideas".
type TripTodo struct {
	TodoID      string           `bson:"todo_id" json:"todo_id"`
	Title       string           `bson:"title" json:"title"`
	Done        bool             `bson:"done" json:"done"`
	DoneBy      string           `bson:"done_by,omitempty" json:"done_by,omitempty"`
	DoneAt      *time.Time       `bson:"done_at,omitempty" json:"done_at,omitempty"`
	Day         *string          `bson:"day,omitempty" json:"day,omitempty"`
	StartTime   *string          `bson:"start_time,omitempty" json:"start_time,omitempty"`
	DurationMin *int             `bson:"duration_min,omitempty" json:"duration_min,omitempty"`
	TZ          string           `bson:"tz,omitempty" json:"tz,omitempty"`
	Order       float64          `bson:"order" json:"order"`
	Category    string           `bson:"category" json:"category"`
	Notes       string           `bson:"notes,omitempty" json:"notes,omitempty"`
	Place       *Place           `bson:"place,omitempty" json:"place,omitempty"`
	V           int64            `bson:"v" json:"v"`
	FieldAt     map[string]int64 `bson:"field_at" json:"-"`
}

// Booking is a vault entry (flight, stay, ticket...).
type Booking struct {
	BookingID        string           `bson:"booking_id" json:"booking_id"`
	Kind             string           `bson:"kind" json:"kind"`
	Title            string           `bson:"title" json:"title"`
	ConfirmationCode string           `bson:"confirmation_code,omitempty" json:"confirmation_code,omitempty"`
	StartsAt         *string          `bson:"starts_at,omitempty" json:"starts_at,omitempty"`
	EndsAt           *string          `bson:"ends_at,omitempty" json:"ends_at,omitempty"`
	StartTZ          *string          `bson:"start_tz,omitempty" json:"start_tz,omitempty"`
	EndTZ            *string          `bson:"end_tz,omitempty" json:"end_tz,omitempty"`
	Place            *Place           `bson:"place,omitempty" json:"place,omitempty"`
	Notes            string           `bson:"notes,omitempty" json:"notes,omitempty"`
	V                int64            `bson:"v" json:"v"`
	FieldAt          map[string]int64 `bson:"field_at" json:"-"`
}

// Tombstone records a deleted todo/booking so deletes sync and creates cannot revive it.
type Tombstone struct {
	ID string    `bson:"id" json:"id"`
	V  int64     `bson:"v" json:"v"`
	At time.Time `bson:"at" json:"at"`
}

// TripFields are the trip's own editable fields (sent whole in deltas when changed).
type TripFields struct {
	Title         string  `bson:"title" json:"title"`
	Destination   *Place  `bson:"destination,omitempty" json:"destination,omitempty"`
	Notes         string  `bson:"notes,omitempty" json:"notes,omitempty"`
	StartDate     *string `bson:"start_date,omitempty" json:"start_date,omitempty"`
	EndDate       *string `bson:"end_date,omitempty" json:"end_date,omitempty"`
	TZ            string  `bson:"tz,omitempty" json:"tz,omitempty"`
	PackingListID *string `bson:"packing_list_id,omitempty" json:"packing_list_id,omitempty"`
}

// Trip is the persisted aggregate (collection "trips").
// Pointer fields (Place, *string, *time.Time) are treated as immutable values:
// code replaces them, never mutates through them, so Clone may share them.
type Trip struct {
	TripID string `bson:"trip_id" json:"trip_id"`
	RoomID string `bson:"room_id" json:"room_id"`
	TripFields `bson:",inline"`
	Todos      []TripTodo `bson:"todos" json:"todos"`
	Bookings   []Booking  `bson:"bookings" json:"bookings"`

	Version    int64            `bson:"version" json:"version"` // +1 per write that changed data
	V          int64            `bson:"v" json:"v"`             // version when TripFields last changed
	FieldAt    map[string]int64 `bson:"field_at" json:"-"`
	Acked      map[string]int64 `bson:"acked" json:"-"` // highest applied op seq per client_id
	Tombstones []Tombstone      `bson:"tombstones,omitempty" json:"-"`
	TombFloor  int64            `bson:"tomb_floor" json:"-"`

	DeletedAt *time.Time `bson:"deleted_at,omitempty" json:"deleted_at,omitempty"`
	DeletedBy string     `bson:"deleted_by,omitempty" json:"deleted_by,omitempty"`
	PurgeAt   *time.Time `bson:"purge_at,omitempty" json:"-"`

	CreatedBy string    `bson:"created_by" json:"created_by"`
	CreatedAt time.Time `bson:"created_at" json:"created_at"`
	UpdatedAt time.Time `bson:"updated_at" json:"updated_at"`
}

func cloneClock(m map[string]int64) map[string]int64 {
	out := make(map[string]int64, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// Clone returns a copy that is safe to mutate (maps and slices are copied).
func (t *Trip) Clone() *Trip {
	c := *t
	c.FieldAt = cloneClock(t.FieldAt)
	c.Acked = cloneClock(t.Acked)
	c.Tombstones = append([]Tombstone(nil), t.Tombstones...)
	c.Todos = make([]TripTodo, len(t.Todos))
	for i, td := range t.Todos {
		td.FieldAt = cloneClock(td.FieldAt)
		c.Todos[i] = td
	}
	c.Bookings = make([]Booking, len(t.Bookings))
	for i, b := range t.Bookings {
		b.FieldAt = cloneClock(b.FieldAt)
		c.Bookings[i] = b
	}
	return &c
}

// Op is one client mutation. Patch is decoded per op type by package trips.
type Op struct {
	V        int             `json:"v"`
	OpID     string          `json:"op_id"`
	ClientID string          `json:"client_id"`
	Seq      int64           `json:"seq"`
	At       int64           `json:"at"` // client clock, ms since epoch
	Type     string          `json:"type"`
	TripID   string          `json:"trip_id"`
	EntityID string          `json:"entity_id,omitempty"`
	Patch    json.RawMessage `json:"patch,omitempty"`
}

// OpResult is the per-op outcome returned to the client.
type OpResult struct {
	OpID          string   `json:"op_id"`
	Status        string   `json:"status"`
	Code          string   `json:"code,omitempty"`
	SkippedFields []string `json:"skipped_fields,omitempty"`
}

// TripDelta is what a client needs to move one trip from BaseVersion to Version.
type TripDelta struct {
	TripID      string      `json:"trip_id"`
	Full        bool        `json:"full"`
	BaseVersion int64       `json:"base_version"`
	Version     int64       `json:"version"`
	Deleted     bool        `json:"deleted,omitempty"`
	DeletedBy   string      `json:"deleted_by,omitempty"`
	Trip        *TripFields `json:"trip,omitempty"`
	Todos       []TripTodo  `json:"todos,omitempty"`
	Bookings    []Booking   `json:"bookings,omitempty"`
	RemovedIDs  []string    `json:"removed_ids,omitempty"`
}

// RemovedTrip tells a client to drop a trip (soft-deleted, restorable) or that it was purged.
type RemovedTrip struct {
	TripID    string `json:"trip_id"`
	DeletedBy string `json:"deleted_by,omitempty"`
	Purged    bool   `json:"purged,omitempty"`
}
```

- [ ] **Step 4: Run to verify it passes, commit**

Run: `cd backend && gofmt -l internal/models && go test ./internal/models/ -count=1`
Expected: PASS, gofmt prints nothing.

```bash
git add backend/internal/models
git commit -m "feat(trips): add trip models

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Patches, validators and op decoding (`internal/trips`)

**Files:**
- Create: `backend/internal/trips/patch.go`, `backend/internal/trips/validate.go`
- Test: `backend/internal/trips/validate_test.go`

**Interfaces:**
- Produces:
  - `Opt[T any] struct{Set bool; Val *T}` (JSON: absent ⇒ `Set=false`; `null` ⇒ `Set=true, Val=nil`; value ⇒ `Set=true, Val=&v`)
  - `TripPatch`, `TodoPatch`, `BookingPatch` (pointer/`Opt` fields)
  - `decodePatch(raw json.RawMessage, dst any) string` returns `""`, `models.CodeUnsupported` or `models.CodeInvalid`
  - op type constants `TypeTripCreate="trip.create"`, `TypeTripUpdate`, `TypeTripDelete`, `TypeTripRestore`, `TypeTodoCreate`, `TypeTodoUpdate`, `TypeTodoDelete`, `TypeBookingCreate`, `TypeBookingUpdate`, `TypeBookingDelete`
  - `MaxTodos=150`, `MaxBookings=50`
  - `ValidateEnvelope(op models.Op) string`, `DecodeOp(raw json.RawMessage) (models.Op, models.OpResult, bool)` — when `ok=false` the returned result is already the rejection to send back
  - validators `validTripPatch(p TripPatch, create bool) bool`, `validTodoPatch(p TodoPatch, create bool) bool`, `validBookingPatch(p BookingPatch, create bool) bool`

- [ ] **Step 1: Write the failing tests**

`backend/internal/trips/validate_test.go`:

```go
package trips

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

var testTripID = "trip_" + strings.Repeat("a", 32)

func rawOp(t *testing.T, m map[string]any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func goodOp() map[string]any {
	return map[string]any{"v": 1, "op_id": "op-1", "client_id": "dev-a", "seq": 1, "at": 1700000000000,
		"type": "trip.create", "trip_id": testTripID, "patch": map[string]any{"title": "Japan"}}
}

func TestDecodeOpAccepts(t *testing.T) {
	op, _, ok := DecodeOp(rawOp(t, goodOp()))
	if !ok || op.Type != TypeTripCreate || op.Seq != 1 {
		t.Fatalf("expected a valid op, got ok=%v op=%+v", ok, op)
	}
}

func TestDecodeOpRejections(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(m map[string]any)
		code   string
	}{
		{"unknown op field", func(m map[string]any) { m["extra"] = 1 }, models.CodeUnsupported},
		{"unknown version", func(m map[string]any) { m["v"] = 2 }, models.CodeUnsupported},
		{"unknown type", func(m map[string]any) { m["type"] = "trip.explode" }, models.CodeUnsupported},
		{"bad trip id", func(m map[string]any) { m["trip_id"] = "trip_nothex" }, models.CodeInvalid},
		{"dotted client id", func(m map[string]any) { m["client_id"] = "a.b" }, models.CodeInvalid},
		{"zero seq", func(m map[string]any) { m["seq"] = 0 }, models.CodeInvalid},
		{"todo op without entity", func(m map[string]any) { m["type"] = "todo.create" }, models.CodeInvalid},
		{"trip op with entity", func(m map[string]any) { m["entity_id"] = "ttd_" + strings.Repeat("1", 32) }, models.CodeInvalid},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := goodOp()
			tc.mutate(m)
			_, res, ok := DecodeOp(rawOp(t, m))
			if ok || res.Status != models.OpRejected || res.Code != tc.code || res.OpID != "op-1" {
				t.Fatalf("want rejected/%s with op_id, got ok=%v res=%+v", tc.code, ok, res)
			}
		})
	}
}

func TestOptDistinguishesAbsentNullAndValue(t *testing.T) {
	var p TodoPatch
	if code := decodePatch(json.RawMessage(`{"day":null,"start_time":"09:30"}`), &p); code != "" {
		t.Fatalf("decode: %s", code)
	}
	if !p.Day.Set || p.Day.Val != nil {
		t.Fatalf("null day should be Set with nil Val: %+v", p.Day)
	}
	if !p.StartTime.Set || p.StartTime.Val == nil || *p.StartTime.Val != "09:30" {
		t.Fatalf("start_time: %+v", p.StartTime)
	}
	if p.Place.Set {
		t.Fatalf("absent place must not be Set")
	}
}

func TestDecodePatchUnknownFieldIsUnsupported(t *testing.T) {
	var p TripPatch
	if code := decodePatch(json.RawMessage(`{"room_id":"x"}`), &p); code != models.CodeUnsupported {
		t.Fatalf("got %q", code)
	}
	if code := decodePatch(json.RawMessage(`{"title":5}`), &p); code != models.CodeInvalid {
		t.Fatalf("wrong type should be invalid, got %q", code)
	}
}

func TestValidators(t *testing.T) {
	s := func(v string) *string { return &v }
	if validTripPatch(TripPatch{}, true) {
		t.Fatal("create needs a title")
	}
	if !validTripPatch(TripPatch{Title: s("Kyoto")}, true) {
		t.Fatal("plain title should be valid")
	}
	if validTripPatch(TripPatch{Title: s("   ")}, true) {
		t.Fatal("blank title invalid")
	}
	if validTripPatch(TripPatch{TZ: s("Mars/Olympus")}, false) {
		t.Fatal("bad tz invalid")
	}
	if validTodoPatch(TodoPatch{Title: s("x"), Category: s("nope")}, true) {
		t.Fatal("bad category invalid")
	}
	if validTodoPatch(TodoPatch{Title: s("x"), StartTime: Opt[string]{Set: true, Val: s("25:99")}}, true) {
		t.Fatal("bad clock invalid")
	}
	if validTodoPatch(TodoPatch{Title: s("x"), Day: Opt[string]{Set: true, Val: s("2026-02-30")}}, true) {
		t.Fatal("impossible date invalid")
	}
	if validBookingPatch(BookingPatch{Title: s("Flight")}, true) {
		t.Fatal("booking create needs kind")
	}
	if !validBookingPatch(BookingPatch{Kind: s("flight"), Title: s("NH 105"),
		StartsAt: Opt[string]{Set: true, Val: s("2026-11-01T09:30")}, StartTZ: Opt[string]{Set: true, Val: s("Asia/Tokyo")}}, true) {
		t.Fatal("valid booking rejected")
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && go test ./internal/trips/ -count=1`
Expected: FAIL (build errors: undefined DecodeOp etc.).

- [ ] **Step 3: Implement `patch.go`**

```go
package trips

import (
	"bytes"
	"encoding/json"
	"strings"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

// Opt distinguishes an absent JSON field from an explicit null from a value.
type Opt[T any] struct {
	Set bool
	Val *T
}

func (o *Opt[T]) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(bytes.TrimSpace(b)) == "null" {
		o.Val = nil
		return nil
	}
	var v T
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	o.Val = &v
	return nil
}

type TripPatch struct {
	Title       *string           `json:"title"`
	Destination Opt[models.Place] `json:"destination"`
	Notes       *string           `json:"notes"`
	StartDate   Opt[string]       `json:"start_date"`
	EndDate     Opt[string]       `json:"end_date"`
	TZ          *string           `json:"tz"`
}

type TodoPatch struct {
	Title       *string           `json:"title"`
	Done        *bool             `json:"done"`
	Day         Opt[string]       `json:"day"`
	StartTime   Opt[string]       `json:"start_time"`
	DurationMin Opt[int]          `json:"duration_min"`
	Order       *float64          `json:"order"`
	Category    *string           `json:"category"`
	Notes       *string           `json:"notes"`
	Place       Opt[models.Place] `json:"place"`
}

type BookingPatch struct {
	Kind             *string           `json:"kind"`
	Title            *string           `json:"title"`
	ConfirmationCode *string           `json:"confirmation_code"`
	StartsAt         Opt[string]       `json:"starts_at"`
	EndsAt           Opt[string]       `json:"ends_at"`
	StartTZ          Opt[string]       `json:"start_tz"`
	EndTZ            Opt[string]       `json:"end_tz"`
	Place            Opt[models.Place] `json:"place"`
	Notes            *string           `json:"notes"`
}

// decodePatch strictly decodes raw into dst. Unknown fields are "unsupported"
// (a newer client), anything else malformed is "invalid".
func decodePatch(raw json.RawMessage, dst any) string {
	if len(raw) == 0 {
		raw = json.RawMessage("{}")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		if strings.HasPrefix(err.Error(), "json: unknown field") {
			return models.CodeUnsupported
		}
		return models.CodeInvalid
	}
	return ""
}
```

- [ ] **Step 4: Implement `validate.go`**

```go
package trips

import (
	"bytes"
	"encoding/json"
	"math"
	"regexp"
	"strings"
	"time"
	_ "time/tzdata" // alpine images ship no zoneinfo
	"unicode/utf8"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

const (
	TypeTripCreate     = "trip.create"
	TypeTripUpdate     = "trip.update"
	TypeTripDelete     = "trip.delete"
	TypeTripRestore    = "trip.restore"
	TypeTodoCreate     = "todo.create"
	TypeTodoUpdate     = "todo.update"
	TypeTodoDelete     = "todo.delete"
	TypeBookingCreate  = "booking.create"
	TypeBookingUpdate  = "booking.update"
	TypeBookingDelete  = "booking.delete"
	MaxTodos           = 150
	MaxBookings        = 50
	maxTripTitle       = 120
	maxItemTitle       = 200
	maxTripNotes       = 16384
	maxItemNotes       = 2048
	maxConfirmation    = 64
)

var (
	reTrip    = regexp.MustCompile(`^trip_[0-9a-f]{32}$`)
	reTodo    = regexp.MustCompile(`^ttd_[0-9a-f]{32}$`)
	reBooking = regexp.MustCompile(`^tbk_[0-9a-f]{32}$`)
	reToken   = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

	categories   = map[string]bool{"food": true, "sight": true, "activity": true, "transport": true, "stay": true, "shopping": true, "other": true}
	bookingKinds = map[string]bool{"flight": true, "stay": true, "train": true, "car": true, "ticket": true, "other": true}
	placeSources = map[string]bool{"photon": true, "pin": true, "manual": true}
)

func okTitle(s string, max int) bool {
	return utf8.RuneCountInString(strings.TrimSpace(s)) > 0 && utf8.RuneCountInString(s) <= max
}
func okBytes(s string, max int) bool { return len(s) <= max }

func validDate(s string) bool {
	_, err := time.Parse("2006-01-02", s)
	return err == nil
}
func validClock(s string) bool {
	_, err := time.Parse("15:04", s)
	return err == nil
}
func validDateTime(s string) bool {
	_, err := time.Parse("2006-01-02T15:04", s)
	return err == nil
}
func validTZ(s string) bool {
	if s == "" || s == "Local" {
		return false
	}
	_, err := time.LoadLocation(s)
	return err == nil
}

func validPlace(p *models.Place) bool {
	if p == nil {
		return true
	}
	return okTitle(p.Name, 200) && utf8.RuneCountInString(p.Address) <= 300 &&
		p.Lat >= -90 && p.Lat <= 90 && p.Lng >= -180 && p.Lng <= 180 &&
		!math.IsNaN(p.Lat) && !math.IsNaN(p.Lng) &&
		len(p.OSMRef) <= 64 && placeSources[p.Source] && (p.TZ == "" || validTZ(p.TZ))
}

// optOK validates an Opt[string] with fn when it carries a value (null clears and is always fine).
func optOK(o Opt[string], fn func(string) bool) bool {
	return !o.Set || o.Val == nil || fn(*o.Val)
}

func validTripPatch(p TripPatch, create bool) bool {
	if create && p.Title == nil {
		return false
	}
	if p.Title != nil && !okTitle(*p.Title, maxTripTitle) {
		return false
	}
	if p.Destination.Set && !validPlace(p.Destination.Val) {
		return false
	}
	if p.Notes != nil && !okBytes(*p.Notes, maxTripNotes) {
		return false
	}
	if !optOK(p.StartDate, validDate) || !optOK(p.EndDate, validDate) {
		return false
	}
	return p.TZ == nil || validTZ(*p.TZ)
}

func validTodoPatch(p TodoPatch, create bool) bool {
	if create && p.Title == nil {
		return false
	}
	if p.Title != nil && !okTitle(*p.Title, maxItemTitle) {
		return false
	}
	if !optOK(p.Day, validDate) || !optOK(p.StartTime, validClock) {
		return false
	}
	if p.DurationMin.Set && p.DurationMin.Val != nil && (*p.DurationMin.Val < 1 || *p.DurationMin.Val > 1440) {
		return false
	}
	if p.Order != nil && (math.IsNaN(*p.Order) || math.IsInf(*p.Order, 0) || math.Abs(*p.Order) > 1e12) {
		return false
	}
	if p.Category != nil && !categories[*p.Category] {
		return false
	}
	if p.Notes != nil && !okBytes(*p.Notes, maxItemNotes) {
		return false
	}
	return !p.Place.Set || validPlace(p.Place.Val)
}

func validBookingPatch(p BookingPatch, create bool) bool {
	if create && (p.Kind == nil || p.Title == nil) {
		return false
	}
	if p.Kind != nil && !bookingKinds[*p.Kind] {
		return false
	}
	if p.Title != nil && !okTitle(*p.Title, maxItemTitle) {
		return false
	}
	if p.ConfirmationCode != nil && utf8.RuneCountInString(*p.ConfirmationCode) > maxConfirmation {
		return false
	}
	if !optOK(p.StartsAt, validDateTime) || !optOK(p.EndsAt, validDateTime) ||
		!optOK(p.StartTZ, validTZ) || !optOK(p.EndTZ, validTZ) {
		return false
	}
	if p.Notes != nil && !okBytes(*p.Notes, maxItemNotes) {
		return false
	}
	return !p.Place.Set || validPlace(p.Place.Val)
}

var knownTypes = map[string]bool{
	TypeTripCreate: true, TypeTripUpdate: true, TypeTripDelete: true, TypeTripRestore: true,
	TypeTodoCreate: true, TypeTodoUpdate: true, TypeTodoDelete: true,
	TypeBookingCreate: true, TypeBookingUpdate: true, TypeBookingDelete: true,
}

// ValidateEnvelope checks everything about an op except its patch. Returns "" or a rejection code.
func ValidateEnvelope(op models.Op) string {
	if op.V != 1 || !knownTypes[op.Type] {
		return models.CodeUnsupported
	}
	if !reToken.MatchString(op.OpID) || !reToken.MatchString(op.ClientID) ||
		op.Seq < 1 || op.At < 1 || !reTrip.MatchString(op.TripID) {
		return models.CodeInvalid
	}
	switch {
	case strings.HasPrefix(op.Type, "todo."):
		if !reTodo.MatchString(op.EntityID) {
			return models.CodeInvalid
		}
	case strings.HasPrefix(op.Type, "booking."):
		if !reBooking.MatchString(op.EntityID) {
			return models.CodeInvalid
		}
	default:
		if op.EntityID != "" {
			return models.CodeInvalid
		}
	}
	return ""
}

// DecodeOp strictly decodes one op. When ok is false, res is the rejection to return for it.
func DecodeOp(raw json.RawMessage) (op models.Op, res models.OpResult, ok bool) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&op); err != nil {
		res = models.OpResult{Status: models.OpRejected, Code: models.CodeInvalid}
		if strings.HasPrefix(err.Error(), "json: unknown field") {
			res.Code = models.CodeUnsupported
		}
		var probe struct {
			OpID string `json:"op_id"`
		}
		_ = json.Unmarshal(raw, &probe)
		res.OpID = probe.OpID
		return op, res, false
	}
	if code := ValidateEnvelope(op); code != "" {
		return op, models.OpResult{OpID: op.OpID, Status: models.OpRejected, Code: code}, false
	}
	return op, models.OpResult{}, true
}
```

- [ ] **Step 5: Run, gofmt, commit**

Run: `cd backend && gofmt -w internal/trips && go vet ./internal/trips/ && go test ./internal/trips/ -count=1`
Expected: PASS.

```bash
git add backend/internal/trips
git commit -m "feat(trips): typed patches, validators and strict op decoding

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `ApplyOp` core + trip-level ops

Covers idempotency, field clocks, clamping, soft delete/restore and patch-injection safety.

**Files:**
- Create: `backend/internal/trips/apply.go`
- Test: `backend/internal/trips/apply_trip_test.go`

**Interfaces:**
- Consumes: Task 3 models, Task 4 decoders/validators.
- Produces:
  - `type Ctx struct{ Actor string; Now time.Time; NewV int64 }`
  - `type Outcome struct{ Dirty, Bump bool }` — `Dirty`: trip must be persisted (acked changed); `Bump`: data changed, `t.Version` was set to `Ctx.NewV`
  - `ApplyOp(t *models.Trip, op models.Op, c Ctx) (models.OpResult, Outcome)`
  - `NewShell(tripID, roomID, actor string, now time.Time) *models.Trip` (Version 0, for `trip.create`)
  - unexported helpers used by Tasks 6–7: `fail(res *models.OpResult, code string) bool`, `commit(clock *map[string]int64, at int64, changes []change, res *models.OpResult) bool`, `type change struct{name string; apply func()}`, `dispatch(...)`

- [ ] **Step 1: Write the failing tests**

`backend/internal/trips/apply_trip_test.go`:

```go
package trips

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

const t0 = int64(1_700_000_000_000)

var now0 = time.UnixMilli(t0 + 10_000_000)

// harness drives ApplyOp the way the service does: one op per "batch".
type harness struct {
	t    *testing.T
	trip *models.Trip
	now  time.Time
	seq  map[string]int64
}

func newHarness(t *testing.T) *harness {
	return &harness{t: t, trip: NewShell(testTripID, "room_1", "user_a", now0), now: now0, seq: map[string]int64{}}
}

func todoID(n int) string    { return "ttd_" + strings.Repeat(fmt.Sprintf("%x", n%16), 32) }
func bookingID(n int) string { return "tbk_" + strings.Repeat(fmt.Sprintf("%x", n%16), 32) }

func (h *harness) do(client, typ, entity string, patch any, at int64) models.OpResult {
	h.t.Helper()
	h.seq[client]++
	return h.doSeq(client, h.seq[client], typ, entity, patch, at)
}

func (h *harness) doSeq(client string, seq int64, typ, entity string, patch any, at int64) models.OpResult {
	h.t.Helper()
	var raw json.RawMessage
	if patch != nil {
		b, err := json.Marshal(patch)
		if err != nil {
			h.t.Fatal(err)
		}
		raw = b
	}
	op := models.Op{V: 1, OpID: fmt.Sprintf("op-%s-%d", client, seq), ClientID: client, Seq: seq, At: at,
		Type: typ, TripID: testTripID, EntityID: entity, Patch: raw}
	res, _ := ApplyOp(h.trip, op, Ctx{Actor: "user_a", Now: h.now, NewV: h.trip.Version + 1})
	return res
}

func mustStatus(t *testing.T, res models.OpResult, status, code string) {
	t.Helper()
	if res.Status != status || res.Code != code {
		t.Fatalf("want %s/%s, got %+v", status, code, res)
	}
}

func TestTripCreateThenDuplicateThenSecondCreateRejected(t *testing.T) {
	h := newHarness(t)
	res := h.do("dev-a", TypeTripCreate, "", map[string]any{"title": "Japan", "start_date": "2026-11-01", "end_date": "2026-11-10"}, t0+1)
	mustStatus(t, res, models.OpApplied, "")
	if h.trip.Version != 1 || h.trip.V != 1 || h.trip.Title != "Japan" {
		t.Fatalf("unexpected trip: %+v", h.trip)
	}
	// replay of the very same op (lost response) is a duplicate and changes nothing
	res = h.doSeq("dev-a", 1, TypeTripCreate, "", map[string]any{"title": "Japan"}, t0+1)
	mustStatus(t, res, models.OpDuplicate, "")
	if h.trip.Version != 1 {
		t.Fatalf("duplicate bumped version")
	}
	// a *new* create for an existing trip is rejected without revealing why
	res = h.do("dev-b", TypeTripCreate, "", map[string]any{"title": "Other"}, t0+2)
	mustStatus(t, res, models.OpRejected, models.CodeForbiddenOrUnknown)
}

func TestNonCreateOnUnknownTripIsForbiddenOrUnknown(t *testing.T) {
	h := newHarness(t)
	res := h.do("dev-a", TypeTripUpdate, "", map[string]any{"title": "x"}, t0+1)
	mustStatus(t, res, models.OpRejected, models.CodeForbiddenOrUnknown)
}

func TestStaleFieldIsConflictedOthersStillApply(t *testing.T) {
	h := newHarness(t)
	h.do("dev-a", TypeTripCreate, "", map[string]any{"title": "Japan"}, t0+1000)
	mustStatus(t, h.do("dev-b", TypeTripUpdate, "", map[string]any{"title": "Japan 2026"}, t0+2000), models.OpApplied, "")
	// offline edit made earlier (1500) than B's title change (2000): title skipped, notes applied
	res := h.do("dev-a", TypeTripUpdate, "", map[string]any{"title": "Nippon", "notes": "bring cash"}, t0+1500)
	if res.Status != models.OpConflicted || len(res.SkippedFields) != 1 || res.SkippedFields[0] != "title" {
		t.Fatalf("want conflicted/[title], got %+v", res)
	}
	if h.trip.Title != "Japan 2026" || h.trip.Notes != "bring cash" {
		t.Fatalf("title=%q notes=%q", h.trip.Title, h.trip.Notes)
	}
}

func TestFutureClientClockIsClamped(t *testing.T) {
	h := newHarness(t)
	h.do("dev-a", TypeTripCreate, "", map[string]any{"title": "Japan"}, t0+1)
	farFuture := h.now.UnixMilli() + int64(3*time.Hour/time.Millisecond)
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"title": "A"}, farFuture), models.OpApplied, "")
	if h.trip.FieldAt["title"] != h.now.UnixMilli() {
		t.Fatalf("clock not clamped: %d vs %d", h.trip.FieldAt["title"], h.now.UnixMilli())
	}
	// a later honest edit (still <= server now) is not blocked forever by the skewed one
	mustStatus(t, h.do("dev-b", TypeTripUpdate, "", map[string]any{"title": "B"}, h.now.UnixMilli()), models.OpApplied, "")
	if h.trip.Title != "B" {
		t.Fatalf("title=%q", h.trip.Title)
	}
}

func TestPatchCannotTouchProtectedFields(t *testing.T) {
	h := newHarness(t)
	h.do("dev-a", TypeTripCreate, "", map[string]any{"title": "Japan"}, t0+1)
	for _, field := range []string{"room_id", "version", "acked", "todos", "packing_list_id", "tombstones"} {
		res := h.do("dev-a", TypeTripUpdate, "", map[string]any{field: "x"}, t0+2)
		mustStatus(t, res, models.OpRejected, models.CodeUnsupported)
	}
	if h.trip.RoomID != "room_1" || h.trip.Version != 1 {
		t.Fatalf("protected state changed: %+v", h.trip)
	}
}

func TestInvalidValuesAndDateOrder(t *testing.T) {
	h := newHarness(t)
	h.do("dev-a", TypeTripCreate, "", map[string]any{"title": "Japan", "start_date": "2026-11-05"}, t0+1)
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"end_date": "2026-11-01"}, t0+2), models.OpRejected, models.CodeInvalid)
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"tz": "Not/AZone"}, t0+3), models.OpRejected, models.CodeInvalid)
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"title": 7}, t0+4), models.OpRejected, models.CodeInvalid)
}

func TestSoftDeleteBlocksEditsAndRestoreRevives(t *testing.T) {
	h := newHarness(t)
	h.do("dev-a", TypeTripCreate, "", map[string]any{"title": "Japan"}, t0+1)
	mustStatus(t, h.do("dev-b", TypeTripDelete, "", nil, t0+100), models.OpApplied, "")
	if h.trip.DeletedAt == nil || h.trip.DeletedBy != "user_a" || h.trip.PurgeAt == nil {
		t.Fatalf("delete metadata missing: %+v", h.trip)
	}
	if got := h.trip.PurgeAt.Sub(*h.trip.DeletedAt); got != 30*24*time.Hour {
		t.Fatalf("purge window = %v", got)
	}
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"title": "x"}, t0+200), models.OpRejected, models.CodeGone)
	// a stale restore (older than the delete) loses to the delete
	res := h.do("dev-a", TypeTripRestore, "", nil, t0+50)
	if res.Status != models.OpConflicted || h.trip.DeletedAt == nil {
		t.Fatalf("stale restore should be conflicted, got %+v", res)
	}
	mustStatus(t, h.do("dev-a", TypeTripRestore, "", nil, t0+300), models.OpApplied, "")
	if h.trip.DeletedAt != nil || h.trip.PurgeAt != nil {
		t.Fatalf("restore did not clear delete state")
	}
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"title": "back"}, t0+400), models.OpApplied, "")
}

func TestRestoreOfLiveTripIsHarmlessNoop(t *testing.T) {
	h := newHarness(t)
	h.do("dev-a", TypeTripCreate, "", map[string]any{"title": "Japan"}, t0+1)
	v := h.trip.Version
	mustStatus(t, h.do("dev-a", TypeTripRestore, "", nil, t0+2), models.OpApplied, "")
	if h.trip.Version != v {
		t.Fatalf("noop restore bumped version")
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && go test ./internal/trips/ -run 'Trip|Stale|Future|Patch|Invalid|SoftDelete|Restore|NonCreate' -count=1`
Expected: FAIL (undefined: ApplyOp, NewShell, Ctx).

- [ ] **Step 3: Implement `apply.go` (core + trip ops; todo/booking dispatch stubs added in Tasks 6–7)**

```go
package trips

import (
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

const (
	tombstoneTTL = 30 * 24 * time.Hour
	trashTTL     = 30 * 24 * time.Hour
)

// Ctx carries per-batch context into ApplyOp.
type Ctx struct {
	Actor string    // user performing the batch
	Now   time.Time // server time
	NewV  int64     // version this batch will write (current Version + 1)
}

// Outcome tells the caller what to persist.
type Outcome struct {
	Dirty bool // the trip changed in some way (at least acked) and must be written
	Bump  bool // data changed; t.Version has been set to Ctx.NewV
}

// NewShell returns an empty, not-yet-persisted trip (Version 0) for trip.create.
func NewShell(tripID, roomID, actor string, now time.Time) *models.Trip {
	return &models.Trip{
		TripID: tripID, RoomID: roomID, CreatedBy: actor, CreatedAt: now, UpdatedAt: now,
		FieldAt: map[string]int64{}, Acked: map[string]int64{},
	}
}

func fail(res *models.OpResult, code string) bool {
	res.Status = models.OpRejected
	res.Code = code
	return false
}

// change is one clocked field assignment.
type change struct {
	name  string
	apply func()
}

// commit applies each change whose clock is not newer than at. Skipped fields mark
// the result conflicted. It reports whether anything was applied.
func commit(clock *map[string]int64, at int64, changes []change, res *models.OpResult) bool {
	if *clock == nil {
		*clock = map[string]int64{}
	}
	applied := false
	for _, ch := range changes {
		if at < (*clock)[ch.name] {
			res.SkippedFields = append(res.SkippedFields, ch.name)
			continue
		}
		ch.apply()
		(*clock)[ch.name] = at
		applied = true
	}
	if len(res.SkippedFields) > 0 {
		res.Status = models.OpConflicted
	}
	return applied
}

// ApplyOp applies one op to t in memory. It never does I/O. The caller persists t
// when the returned Outcome is Dirty (insert for a new shell, compare-and-swap otherwise).
func ApplyOp(t *models.Trip, op models.Op, c Ctx) (models.OpResult, Outcome) {
	res := models.OpResult{OpID: op.OpID, Status: models.OpApplied}
	if code := ValidateEnvelope(op); code != "" {
		fail(&res, code)
		return res, Outcome{}
	}
	if op.Seq <= t.Acked[op.ClientID] {
		res.Status = models.OpDuplicate
		return res, Outcome{}
	}
	if t.Version == 0 && op.Type != TypeTripCreate {
		fail(&res, models.CodeForbiddenOrUnknown)
		return res, Outcome{}
	}
	at := op.At
	if ms := c.Now.UnixMilli(); at > ms {
		at = ms // a skewed phone clock must not win forever
	}
	bump := dispatch(t, op, at, c, &res)
	if t.Acked == nil {
		t.Acked = map[string]int64{}
	}
	t.Acked[op.ClientID] = op.Seq // every non-duplicate outcome consumes the seq
	if bump {
		t.Version = c.NewV
	}
	return res, Outcome{Dirty: true, Bump: bump}
}

func dispatch(t *models.Trip, op models.Op, at int64, c Ctx, res *models.OpResult) bool {
	if t.DeletedAt != nil && op.Type != TypeTripRestore {
		return fail(res, models.CodeGone)
	}
	switch op.Type {
	case TypeTripCreate:
		return tripCreate(t, op, at, c, res)
	case TypeTripUpdate:
		return tripUpdate(t, op, at, c, res)
	case TypeTripDelete:
		return tripDelete(t, at, c, res)
	case TypeTripRestore:
		return tripRestore(t, at, res)
	case TypeTodoCreate:
		return todoCreate(t, op, at, c, res)
	case TypeTodoUpdate:
		return todoUpdate(t, op, at, c, res)
	case TypeTodoDelete:
		return todoDelete(t, op, c, res)
	case TypeBookingCreate:
		return bookingCreate(t, op, at, c, res)
	case TypeBookingUpdate:
		return bookingUpdate(t, op, at, c, res)
	case TypeBookingDelete:
		return bookingDelete(t, op, c, res)
	}
	return fail(res, models.CodeUnsupported)
}

// pick returns the effective value of a date field after a patch.
func pick(o Opt[string], cur *string) *string {
	if o.Set {
		return o.Val
	}
	return cur
}

// datesOrdered reports whether end >= start (ISO dates compare lexicographically).
func datesOrdered(start, end *string) bool {
	return start == nil || end == nil || *end >= *start
}

func tripChanges(t *models.Trip, p TripPatch) []change {
	var ch []change
	if p.Title != nil {
		v := *p.Title
		ch = append(ch, change{"title", func() { t.Title = v }})
	}
	if p.Destination.Set {
		v := p.Destination.Val
		ch = append(ch, change{"destination", func() { t.Destination = v }})
	}
	if p.Notes != nil {
		v := *p.Notes
		ch = append(ch, change{"notes", func() { t.Notes = v }})
	}
	if p.StartDate.Set {
		v := p.StartDate.Val
		ch = append(ch, change{"start_date", func() { t.StartDate = v }})
	}
	if p.EndDate.Set {
		v := p.EndDate.Val
		ch = append(ch, change{"end_date", func() { t.EndDate = v }})
	}
	if p.TZ != nil {
		v := *p.TZ
		ch = append(ch, change{"tz", func() { t.TZ = v }})
	}
	return ch
}

func tripCreate(t *models.Trip, op models.Op, at int64, c Ctx, res *models.OpResult) bool {
	if t.Version != 0 {
		return fail(res, models.CodeForbiddenOrUnknown)
	}
	var p TripPatch
	if code := decodePatch(op.Patch, &p); code != "" {
		return fail(res, code)
	}
	if !validTripPatch(p, true) || !datesOrdered(pick(p.StartDate, nil), pick(p.EndDate, nil)) {
		return fail(res, models.CodeInvalid)
	}
	commit(&t.FieldAt, at, tripChanges(t, p), res)
	if t.TZ == "" && t.Destination != nil {
		t.TZ = t.Destination.TZ // taken from the destination once, then only explicit edits change it
	}
	t.V = c.NewV
	return true
}

func tripUpdate(t *models.Trip, op models.Op, at int64, c Ctx, res *models.OpResult) bool {
	var p TripPatch
	if code := decodePatch(op.Patch, &p); code != "" {
		return fail(res, code)
	}
	if !validTripPatch(p, false) || !datesOrdered(pick(p.StartDate, t.StartDate), pick(p.EndDate, t.EndDate)) {
		return fail(res, models.CodeInvalid)
	}
	if !commit(&t.FieldAt, at, tripChanges(t, p), res) {
		return false
	}
	t.V = c.NewV
	return true
}

func tripDelete(t *models.Trip, at int64, c Ctx, res *models.OpResult) bool {
	return commit(&t.FieldAt, at, []change{{"deleted", func() {
		d := c.Now
		p := c.Now.Add(trashTTL)
		t.DeletedAt, t.DeletedBy, t.PurgeAt = &d, c.Actor, &p
	}}}, res)
}

func tripRestore(t *models.Trip, at int64, res *models.OpResult) bool {
	if t.DeletedAt == nil {
		return false // already live: idempotent no-op
	}
	return commit(&t.FieldAt, at, []change{{"deleted", func() {
		t.DeletedAt, t.DeletedBy, t.PurgeAt = nil, "", nil
	}}}, res)
}
```

Temporarily add stubs so the package compiles until Tasks 6–7 replace them (put in `apply_stubs.go`, deleted in Task 7):

```go
package trips

import "github.com/janvillarosa/gracie-app/backend/internal/models"

func todoCreate(*models.Trip, models.Op, int64, Ctx, *models.OpResult) bool    { return false }
func todoUpdate(*models.Trip, models.Op, int64, Ctx, *models.OpResult) bool    { return false }
func todoDelete(*models.Trip, models.Op, Ctx, *models.OpResult) bool           { return false }
func bookingCreate(*models.Trip, models.Op, int64, Ctx, *models.OpResult) bool { return false }
func bookingUpdate(*models.Trip, models.Op, int64, Ctx, *models.OpResult) bool { return false }
func bookingDelete(*models.Trip, models.Op, Ctx, *models.OpResult) bool        { return false }
```

- [ ] **Step 4: Run, gofmt, commit**

Run: `cd backend && gofmt -w internal/trips && go vet ./internal/trips/ && go test ./internal/trips/ -count=1`
Expected: PASS.

```bash
git add backend/internal/trips
git commit -m "feat(trips): ApplyOp core with idempotency, field clocks and trip ops

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Todo ops, tombstones, ordering

**Files:**
- Modify: `backend/internal/trips/apply.go` (append), delete the todo stubs from `apply_stubs.go`
- Test: `backend/internal/trips/apply_todo_test.go`

**Interfaces:**
- Consumes: `commit`, `fail`, `change`, `Ctx` (Task 5).
- Produces: `todoCreate/todoUpdate/todoDelete`, `findTodo(t, id) int`, `tombstoned(t, id) bool`, `renumberIfCramped(t, newV)`, `resolveTodoTZ(t, td)`, consts `orderStep=1000.0`, `minOrderGap=1e-7`.

- [ ] **Step 1: Write the failing tests**

`backend/internal/trips/apply_todo_test.go`:

```go
package trips

import (
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func newTripH(t *testing.T) *harness {
	h := newHarness(t)
	mustStatus(t, h.do("dev-a", TypeTripCreate, "", map[string]any{"title": "Japan", "tz": "Asia/Tokyo"}, t0+1), models.OpApplied, "")
	return h
}

func TestTodoCreateUpdateDeleteLifecycle(t *testing.T) {
	h := newTripH(t)
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{
		"title": "Fushimi Inari", "day": "2026-11-02", "start_time": "07:30", "category": "sight",
		"place": map[string]any{"name": "Fushimi Inari", "lat": 34.967, "lng": 135.772, "tz": "Asia/Tokyo", "source": "manual"},
	}, t0+10), models.OpApplied, "")
	td := h.trip.Todos[0]
	if td.TZ != "Asia/Tokyo" || td.Order != 1000 || td.V != h.trip.Version || td.Category != "sight" {
		t.Fatalf("unexpected todo: %+v", td)
	}
	mustStatus(t, h.do("dev-b", TypeTodoUpdate, todoID(1), map[string]any{"done": true}, t0+20), models.OpApplied, "")
	if !h.trip.Todos[0].Done || h.trip.Todos[0].DoneBy != "user_a" || h.trip.Todos[0].DoneAt == nil {
		t.Fatalf("done metadata missing: %+v", h.trip.Todos[0])
	}
	mustStatus(t, h.do("dev-b", TypeTodoUpdate, todoID(1), map[string]any{"done": false, "day": nil}, t0+30), models.OpApplied, "")
	if h.trip.Todos[0].Done || h.trip.Todos[0].DoneBy != "" || h.trip.Todos[0].Day != nil {
		t.Fatalf("undo/ideas move failed: %+v", h.trip.Todos[0])
	}
	mustStatus(t, h.do("dev-a", TypeTodoDelete, todoID(1), nil, t0+40), models.OpApplied, "")
	if len(h.trip.Todos) != 0 || len(h.trip.Tombstones) != 1 || h.trip.Tombstones[0].ID != todoID(1) {
		t.Fatalf("delete should tombstone: %+v", h.trip)
	}
}

func TestTodoEditAfterDeleteIsGoneAndCreateDoesNotRevive(t *testing.T) {
	h := newTripH(t)
	h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "Ramen"}, t0+10)
	h.do("dev-b", TypeTodoDelete, todoID(1), nil, t0+20)
	mustStatus(t, h.do("dev-a", TypeTodoUpdate, todoID(1), map[string]any{"title": "Ramen!"}, t0+15), models.OpRejected, models.CodeGone)
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "Ramen"}, t0+12), models.OpRejected, models.CodeGone)
	if len(h.trip.Todos) != 0 {
		t.Fatalf("tombstoned todo was revived")
	}
	// deleting again is an idempotent no-op
	v := h.trip.Version
	mustStatus(t, h.do("dev-a", TypeTodoDelete, todoID(1), nil, t0+30), models.OpApplied, "")
	if h.trip.Version != v || len(h.trip.Tombstones) != 1 {
		t.Fatalf("repeat delete changed state")
	}
}

func TestTodoCap(t *testing.T) {
	h := newTripH(t)
	for i := 0; i < MaxTodos; i++ {
		h.trip.Todos = append(h.trip.Todos, models.TripTodo{TodoID: "ttd_" + padHex(i+100)})
	}
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "one too many"}, t0+10), models.OpRejected, models.CodeCap)
}

func TestTodoValidation(t *testing.T) {
	h := newTripH(t)
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{}, t0+10), models.OpRejected, models.CodeInvalid)
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "x", "category": "nope"}, t0+11), models.OpRejected, models.CodeInvalid)
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "x", "bogus": 1}, t0+12), models.OpRejected, models.CodeUnsupported)
	mustStatus(t, h.do("dev-a", TypeTodoUpdate, todoID(2), map[string]any{"title": "x"}, t0+13), models.OpRejected, models.CodeGone)
}

func TestEqualOrdersAreRenumberedDistinctAndStable(t *testing.T) {
	h := newTripH(t)
	// two devices insert at exactly the same spot (explicit equal order) on the same day
	h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "A", "day": "2026-11-02", "order": 500.0}, t0+10)
	h.do("dev-b", TypeTodoCreate, todoID(2), map[string]any{"title": "B", "day": "2026-11-02", "order": 500.0}, t0+11)
	o1, o2 := h.trip.Todos[0].Order, h.trip.Todos[1].Order
	if o1 == o2 {
		t.Fatalf("orders still equal: %v %v", o1, o2)
	}
	// tie-break is by todo_id, so ttd_1... sorts before ttd_2...
	if !(o1 < o2) {
		t.Fatalf("expected todo 1 before todo 2, got %v %v", o1, o2)
	}
	if h.trip.Todos[0].V != h.trip.Version || h.trip.Todos[1].V != h.trip.Version {
		t.Fatalf("renumbered todos must carry the new version so deltas include them")
	}
}

func TestCrampedGapIsRenumbered(t *testing.T) {
	h := newTripH(t)
	h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "A", "order": 1000.0}, t0+10)
	h.do("dev-a", TypeTodoCreate, todoID(2), map[string]any{"title": "B", "order": 2000.0}, t0+11)
	h.do("dev-a", TypeTodoCreate, todoID(3), map[string]any{"title": "C", "order": 1000.00000001}, t0+12)
	for i := 1; i < len(h.trip.Todos); i++ {
		if h.trip.Todos[i].Order == h.trip.Todos[i-1].Order {
			t.Fatalf("duplicate orders after renumber")
		}
	}
	// A (1000) and C (1000.00000001) keep their relative order: A < C < B
	byID := map[string]float64{}
	for _, td := range h.trip.Todos {
		byID[td.TodoID] = td.Order
	}
	if !(byID[todoID(1)] < byID[todoID(3)] && byID[todoID(3)] < byID[todoID(2)]) {
		t.Fatalf("relative order lost: %v", byID)
	}
}

func TestReplayAfterManyOtherOpsDoesNotDoubleApply(t *testing.T) {
	h := newTripH(t)
	h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "Ramen"}, t0+10)
	// dev-a sends seq N, response is lost
	h.do("dev-a", TypeTodoUpdate, todoID(1), map[string]any{"title": "Ramen v2"}, t0+20)
	lostSeq := h.seq["dev-a"]
	// meanwhile another device does far more than 1000 ops, including deleting and recreating
	for i := 0; i < 1500; i++ {
		h.do("dev-b", TypeTodoUpdate, todoID(1), map[string]any{"title": "b"}, t0+100+int64(i))
	}
	before := h.trip.Todos[0]
	v := h.trip.Version
	res := h.doSeq("dev-a", lostSeq, TypeTodoUpdate, todoID(1), map[string]any{"title": "Ramen v2"}, t0+20)
	mustStatus(t, res, models.OpDuplicate, "")
	if h.trip.Version != v || h.trip.Todos[0].Title != before.Title {
		t.Fatalf("replay changed state")
	}
}

func padHex(n int) string {
	const digits = "0123456789abcdef"
	b := make([]byte, 32)
	for i := range b {
		b[i] = digits[(n+i)%16]
	}
	return string(b)
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && go test ./internal/trips/ -run 'Todo|Order|Cramped|Replay' -count=1`
Expected: FAIL (stubs return false so statuses are `applied` with no changes / nil index panics).

- [ ] **Step 3: Implement** — remove the three todo stubs from `apply_stubs.go`, then append to `apply.go` (add `"sort"` to its imports):

```go
const (
	orderStep   = 1000.0
	minOrderGap = 1e-7
)

func findTodo(t *models.Trip, id string) int {
	for i := range t.Todos {
		if t.Todos[i].TodoID == id {
			return i
		}
	}
	return -1
}

func tombstoned(t *models.Trip, id string) bool {
	for _, ts := range t.Tombstones {
		if ts.ID == id {
			return true
		}
	}
	return false
}

// resolveTodoTZ stores the effective zone at write time: place.tz, else the trip's.
func resolveTodoTZ(t *models.Trip, td *models.TripTodo) {
	if td.Place != nil && td.Place.TZ != "" {
		td.TZ = td.Place.TZ
		return
	}
	td.TZ = t.TZ
}

func dayKey(d *string) string {
	if d == nil {
		return ""
	}
	return *d
}

func nextOrder(t *models.Trip, day *string) float64 {
	max, any := 0.0, false
	for i := range t.Todos {
		if dayKey(t.Todos[i].Day) == dayKey(day) && (!any || t.Todos[i].Order > max) {
			max, any = t.Todos[i].Order, true
		}
	}
	if !any {
		return orderStep
	}
	return max + orderStep
}

// renumberIfCramped re-spaces any day group (or Ideas) whose neighbours are closer than
// minOrderGap (including equal orders from two offline inserts). Ties break by todo_id.
func renumberIfCramped(t *models.Trip, newV int64) {
	groups := map[string][]int{}
	for i := range t.Todos {
		k := dayKey(t.Todos[i].Day)
		groups[k] = append(groups[k], i)
	}
	for _, idx := range groups {
		sort.Slice(idx, func(a, b int) bool {
			x, y := &t.Todos[idx[a]], &t.Todos[idx[b]]
			if x.Order != y.Order {
				return x.Order < y.Order
			}
			return x.TodoID < y.TodoID
		})
		cramped := false
		for k := 1; k < len(idx); k++ {
			if t.Todos[idx[k]].Order-t.Todos[idx[k-1]].Order < minOrderGap {
				cramped = true
				break
			}
		}
		if !cramped {
			continue
		}
		for k, i := range idx {
			t.Todos[i].Order = float64(k+1) * orderStep
			t.Todos[i].V = newV
		}
	}
}

func todoChanges(td *models.TripTodo, p TodoPatch, actor string, now time.Time) []change {
	var ch []change
	if p.Title != nil {
		v := *p.Title
		ch = append(ch, change{"title", func() { td.Title = v }})
	}
	if p.Done != nil {
		d := *p.Done
		ch = append(ch, change{"done", func() {
			td.Done = d
			if d {
				n := now
				td.DoneBy, td.DoneAt = actor, &n
			} else {
				td.DoneBy, td.DoneAt = "", nil
			}
		}})
	}
	if p.Day.Set {
		v := p.Day.Val
		ch = append(ch, change{"day", func() { td.Day = v }})
	}
	if p.StartTime.Set {
		v := p.StartTime.Val
		ch = append(ch, change{"start_time", func() { td.StartTime = v }})
	}
	if p.DurationMin.Set {
		v := p.DurationMin.Val
		ch = append(ch, change{"duration_min", func() { td.DurationMin = v }})
	}
	if p.Order != nil {
		v := *p.Order
		ch = append(ch, change{"order", func() { td.Order = v }})
	}
	if p.Category != nil {
		v := *p.Category
		ch = append(ch, change{"category", func() { td.Category = v }})
	}
	if p.Notes != nil {
		v := *p.Notes
		ch = append(ch, change{"notes", func() { td.Notes = v }})
	}
	if p.Place.Set {
		v := p.Place.Val
		ch = append(ch, change{"place", func() { td.Place = v }})
	}
	return ch
}

func todoCreate(t *models.Trip, op models.Op, at int64, c Ctx, res *models.OpResult) bool {
	if len(t.Todos) >= MaxTodos {
		return fail(res, models.CodeCap)
	}
	if tombstoned(t, op.EntityID) {
		return fail(res, models.CodeGone)
	}
	if findTodo(t, op.EntityID) >= 0 {
		return fail(res, models.CodeInvalid)
	}
	var p TodoPatch
	if code := decodePatch(op.Patch, &p); code != "" {
		return fail(res, code)
	}
	if !validTodoPatch(p, true) {
		return fail(res, models.CodeInvalid)
	}
	td := models.TripTodo{TodoID: op.EntityID, Category: "other", FieldAt: map[string]int64{}}
	commit(&td.FieldAt, at, todoChanges(&td, p, c.Actor, c.Now), res)
	if p.Order == nil {
		td.Order = nextOrder(t, td.Day)
	}
	td.V = c.NewV
	resolveTodoTZ(t, &td)
	t.Todos = append(t.Todos, td)
	renumberIfCramped(t, c.NewV)
	return true
}

func todoUpdate(t *models.Trip, op models.Op, at int64, c Ctx, res *models.OpResult) bool {
	i := findTodo(t, op.EntityID)
	if i < 0 {
		return fail(res, models.CodeGone)
	}
	var p TodoPatch
	if code := decodePatch(op.Patch, &p); code != "" {
		return fail(res, code)
	}
	if !validTodoPatch(p, false) {
		return fail(res, models.CodeInvalid)
	}
	td := &t.Todos[i]
	if !commit(&td.FieldAt, at, todoChanges(td, p, c.Actor, c.Now), res) {
		return false
	}
	td.V = c.NewV
	resolveTodoTZ(t, td)
	if p.Order != nil || p.Day.Set {
		renumberIfCramped(t, c.NewV)
	}
	return true
}

func todoDelete(t *models.Trip, op models.Op, c Ctx, res *models.OpResult) bool {
	i := findTodo(t, op.EntityID)
	if i < 0 {
		return false // already gone (tombstoned or never existed): idempotent
	}
	t.Todos = append(t.Todos[:i], t.Todos[i+1:]...)
	t.Tombstones = append(t.Tombstones, models.Tombstone{ID: op.EntityID, V: c.NewV, At: c.Now})
	return true
}
```

- [ ] **Step 4: Run, gofmt, commit**

Run: `cd backend && gofmt -w internal/trips && go vet ./internal/trips/ && go test ./internal/trips/ -count=1`
Expected: PASS.

```bash
git add backend/internal/trips
git commit -m "feat(trips): todo ops with tombstones and order renumbering

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Booking ops

**Files:**
- Modify: `backend/internal/trips/apply.go` (append); delete `apply_stubs.go`
- Test: `backend/internal/trips/apply_booking_test.go`

**Interfaces:**
- Produces: `bookingCreate/bookingUpdate/bookingDelete`, `findBooking(t, id) int`.

- [ ] **Step 1: Write the failing tests**

`backend/internal/trips/apply_booking_test.go`:

```go
package trips

import (
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func TestBookingLifecycleWithTwoZones(t *testing.T) {
	h := newTripH(t)
	mustStatus(t, h.do("dev-a", TypeBookingCreate, bookingID(1), map[string]any{
		"kind": "flight", "title": "NH 105", "confirmation_code": "ABC123",
		"starts_at": "2026-11-01T09:30", "start_tz": "Asia/Tokyo",
		"ends_at": "2026-11-01T07:10", "end_tz": "America/Los_Angeles",
	}, t0+10), models.OpApplied, "")
	b := h.trip.Bookings[0]
	if b.ConfirmationCode != "ABC123" || *b.StartTZ != "Asia/Tokyo" || *b.EndTZ != "America/Los_Angeles" || b.V != h.trip.Version {
		t.Fatalf("unexpected booking: %+v", b)
	}
	mustStatus(t, h.do("dev-b", TypeBookingUpdate, bookingID(1), map[string]any{"ends_at": nil}, t0+20), models.OpApplied, "")
	if h.trip.Bookings[0].EndsAt != nil {
		t.Fatalf("ends_at should be cleared")
	}
	mustStatus(t, h.do("dev-b", TypeBookingDelete, bookingID(1), nil, t0+30), models.OpApplied, "")
	if len(h.trip.Bookings) != 0 || len(h.trip.Tombstones) != 1 {
		t.Fatalf("delete should tombstone: %+v", h.trip)
	}
	mustStatus(t, h.do("dev-a", TypeBookingCreate, bookingID(1), map[string]any{"kind": "flight", "title": "again"}, t0+5), models.OpRejected, models.CodeGone)
	mustStatus(t, h.do("dev-a", TypeBookingUpdate, bookingID(1), map[string]any{"title": "x"}, t0+6), models.OpRejected, models.CodeGone)
}

func TestBookingValidationAndCap(t *testing.T) {
	h := newTripH(t)
	mustStatus(t, h.do("dev-a", TypeBookingCreate, bookingID(1), map[string]any{"title": "no kind"}, t0+10), models.OpRejected, models.CodeInvalid)
	mustStatus(t, h.do("dev-a", TypeBookingCreate, bookingID(1), map[string]any{"kind": "boat", "title": "x"}, t0+11), models.OpRejected, models.CodeInvalid)
	mustStatus(t, h.do("dev-a", TypeBookingCreate, bookingID(1), map[string]any{"kind": "stay", "title": "x", "starts_at": "tomorrow"}, t0+12), models.OpRejected, models.CodeInvalid)
	for i := 0; i < MaxBookings; i++ {
		h.trip.Bookings = append(h.trip.Bookings, models.Booking{BookingID: "tbk_" + padHex(i+100)})
	}
	mustStatus(t, h.do("dev-a", TypeBookingCreate, bookingID(2), map[string]any{"kind": "stay", "title": "x"}, t0+13), models.OpRejected, models.CodeCap)
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && go test ./internal/trips/ -run Booking -count=1`
Expected: FAIL.

- [ ] **Step 3: Implement** — delete `apply_stubs.go`, append to `apply.go`:

```go
func findBooking(t *models.Trip, id string) int {
	for i := range t.Bookings {
		if t.Bookings[i].BookingID == id {
			return i
		}
	}
	return -1
}

func bookingChanges(b *models.Booking, p BookingPatch) []change {
	var ch []change
	if p.Kind != nil {
		v := *p.Kind
		ch = append(ch, change{"kind", func() { b.Kind = v }})
	}
	if p.Title != nil {
		v := *p.Title
		ch = append(ch, change{"title", func() { b.Title = v }})
	}
	if p.ConfirmationCode != nil {
		v := *p.ConfirmationCode
		ch = append(ch, change{"confirmation_code", func() { b.ConfirmationCode = v }})
	}
	if p.StartsAt.Set {
		v := p.StartsAt.Val
		ch = append(ch, change{"starts_at", func() { b.StartsAt = v }})
	}
	if p.EndsAt.Set {
		v := p.EndsAt.Val
		ch = append(ch, change{"ends_at", func() { b.EndsAt = v }})
	}
	if p.StartTZ.Set {
		v := p.StartTZ.Val
		ch = append(ch, change{"start_tz", func() { b.StartTZ = v }})
	}
	if p.EndTZ.Set {
		v := p.EndTZ.Val
		ch = append(ch, change{"end_tz", func() { b.EndTZ = v }})
	}
	if p.Place.Set {
		v := p.Place.Val
		ch = append(ch, change{"place", func() { b.Place = v }})
	}
	if p.Notes != nil {
		v := *p.Notes
		ch = append(ch, change{"notes", func() { b.Notes = v }})
	}
	return ch
}

func bookingCreate(t *models.Trip, op models.Op, at int64, c Ctx, res *models.OpResult) bool {
	if len(t.Bookings) >= MaxBookings {
		return fail(res, models.CodeCap)
	}
	if tombstoned(t, op.EntityID) {
		return fail(res, models.CodeGone)
	}
	if findBooking(t, op.EntityID) >= 0 {
		return fail(res, models.CodeInvalid)
	}
	var p BookingPatch
	if code := decodePatch(op.Patch, &p); code != "" {
		return fail(res, code)
	}
	if !validBookingPatch(p, true) {
		return fail(res, models.CodeInvalid)
	}
	b := models.Booking{BookingID: op.EntityID, FieldAt: map[string]int64{}}
	commit(&b.FieldAt, at, bookingChanges(&b, p), res)
	b.V = c.NewV
	t.Bookings = append(t.Bookings, b)
	return true
}

func bookingUpdate(t *models.Trip, op models.Op, at int64, c Ctx, res *models.OpResult) bool {
	i := findBooking(t, op.EntityID)
	if i < 0 {
		return fail(res, models.CodeGone)
	}
	var p BookingPatch
	if code := decodePatch(op.Patch, &p); code != "" {
		return fail(res, code)
	}
	if !validBookingPatch(p, false) {
		return fail(res, models.CodeInvalid)
	}
	b := &t.Bookings[i]
	if !commit(&b.FieldAt, at, bookingChanges(b, p), res) {
		return false
	}
	b.V = c.NewV
	return true
}

func bookingDelete(t *models.Trip, op models.Op, c Ctx, res *models.OpResult) bool {
	i := findBooking(t, op.EntityID)
	if i < 0 {
		return false
	}
	t.Bookings = append(t.Bookings[:i], t.Bookings[i+1:]...)
	t.Tombstones = append(t.Tombstones, models.Tombstone{ID: op.EntityID, V: c.NewV, At: c.Now})
	return true
}
```

- [ ] **Step 4: Run, gofmt, commit**

Run: `cd backend && gofmt -w internal/trips && go vet ./internal/trips/ && go test ./internal/trips/ -count=1`
Expected: PASS.

```bash
git add backend/internal/trips
git commit -m "feat(trips): booking ops

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `DeltaSince` and `PruneTombstones`

**Files:**
- Create: `backend/internal/trips/delta.go`
- Test: `backend/internal/trips/delta_test.go`

**Interfaces:**
- Produces:
  - `DeltaSince(t *models.Trip, known int64, present bool) models.TripDelta` — `present=false` (client has no copy) or `known < t.TombFloor` ⇒ `Full`.
  - `PruneTombstones(t *models.Trip, now time.Time)`.

- [ ] **Step 1: Write the failing tests**

`backend/internal/trips/delta_test.go`:

```go
package trips

import (
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func TestDeltaFullForUnknownTrip(t *testing.T) {
	h := newTripH(t)
	h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "Ramen"}, t0+10)
	d := DeltaSince(h.trip, 0, false)
	if !d.Full || d.Trip == nil || len(d.Todos) != 1 || d.Version != h.trip.Version || d.BaseVersion != 0 {
		t.Fatalf("bad full delta: %+v", d)
	}
}

func TestDeltaOnlyIncludesWhatChanged(t *testing.T) {
	h := newTripH(t)
	h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "Ramen"}, t0+10)
	h.do("dev-a", TypeTodoCreate, todoID(2), map[string]any{"title": "Sushi"}, t0+11)
	known := h.trip.Version
	h.do("dev-b", TypeTodoUpdate, todoID(1), map[string]any{"done": true}, t0+20) // one tick
	d := DeltaSince(h.trip, known, true)
	if d.Full || d.Trip != nil || len(d.Todos) != 1 || d.Todos[0].TodoID != todoID(1) || d.BaseVersion != known {
		t.Fatalf("a single tick must produce a one-todo delta, got %+v", d)
	}
	if got := DeltaSince(h.trip, h.trip.Version, true); got.Trip != nil || len(got.Todos) != 0 || len(got.Bookings) != 0 || len(got.RemovedIDs) != 0 {
		t.Fatalf("up-to-date client should get an empty delta: %+v", got)
	}
}

func TestDeltaCarriesTripFieldsAndRemovals(t *testing.T) {
	h := newTripH(t)
	h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "Ramen"}, t0+10)
	known := h.trip.Version
	h.do("dev-b", TypeTripUpdate, "", map[string]any{"title": "Japan 2026"}, t0+20)
	h.do("dev-b", TypeTodoDelete, todoID(1), nil, t0+30)
	d := DeltaSince(h.trip, known, true)
	if d.Trip == nil || d.Trip.Title != "Japan 2026" || len(d.RemovedIDs) != 1 || d.RemovedIDs[0] != todoID(1) {
		t.Fatalf("bad delta: %+v", d)
	}
}

func TestDeltaReportsSoftDelete(t *testing.T) {
	h := newTripH(t)
	known := h.trip.Version
	h.do("dev-b", TypeTripDelete, "", nil, t0+20)
	d := DeltaSince(h.trip, known, true)
	if !d.Deleted || d.DeletedBy != "user_a" {
		t.Fatalf("bad delta: %+v", d)
	}
}

func TestPruneTombstonesForcesFullCopyForStaleClients(t *testing.T) {
	h := newTripH(t)
	h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "Ramen"}, t0+10)
	staleKnown := h.trip.Version
	h.do("dev-a", TypeTodoDelete, todoID(1), nil, t0+20)
	deletedAtV := h.trip.Version
	PruneTombstones(h.trip, h.now.Add(31*24*time.Hour))
	if len(h.trip.Tombstones) != 0 || h.trip.TombFloor != deletedAtV {
		t.Fatalf("prune: tombstones=%d floor=%d", len(h.trip.Tombstones), h.trip.TombFloor)
	}
	if d := DeltaSince(h.trip, staleKnown, true); !d.Full {
		t.Fatalf("client behind the floor must get a full copy: %+v", d)
	}
	if d := DeltaSince(h.trip, deletedAtV, true); d.Full {
		t.Fatalf("client at the floor has seen the deletion, delta is enough: %+v", d)
	}
	// young tombstones are kept
	h.do("dev-a", TypeTodoCreate, todoID(2), map[string]any{"title": "x"}, t0+30)
	h.do("dev-a", TypeTodoDelete, todoID(2), nil, t0+40)
	PruneTombstones(h.trip, h.now)
	if len(h.trip.Tombstones) != 1 {
		t.Fatalf("young tombstone pruned")
	}
	_ = models.Trip{}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && go test ./internal/trips/ -run 'Delta|Prune' -count=1`
Expected: FAIL (undefined: DeltaSince).

- [ ] **Step 3: Implement `delta.go`**

```go
package trips

import (
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

// DeltaSince builds what a client at version `known` needs to reach t.Version.
// present=false means the client has no copy. A client older than the pruned
// tombstone floor also gets a full copy, because it can't learn every deletion.
func DeltaSince(t *models.Trip, known int64, present bool) models.TripDelta {
	d := models.TripDelta{
		TripID: t.TripID, Version: t.Version, BaseVersion: known,
		Deleted: t.DeletedAt != nil, DeletedBy: t.DeletedBy,
	}
	full := !present || known < t.TombFloor
	if full {
		d.Full, d.BaseVersion = true, 0
		known = 0
	}
	if full || t.V > known {
		f := t.TripFields
		d.Trip = &f
	}
	for _, td := range t.Todos {
		if full || td.V > known {
			d.Todos = append(d.Todos, td)
		}
	}
	for _, b := range t.Bookings {
		if full || b.V > known {
			d.Bookings = append(d.Bookings, b)
		}
	}
	if !full {
		for _, ts := range t.Tombstones {
			if ts.V > known {
				d.RemovedIDs = append(d.RemovedIDs, ts.ID)
			}
		}
	}
	return d
}

// PruneTombstones drops tombstones older than 30 days and raises TombFloor to the
// highest pruned version, so clients behind it are sent a full copy.
func PruneTombstones(t *models.Trip, now time.Time) {
	cutoff := now.Add(-tombstoneTTL)
	kept := make([]models.Tombstone, 0, len(t.Tombstones))
	for _, ts := range t.Tombstones {
		if ts.At.Before(cutoff) {
			if ts.V > t.TombFloor {
				t.TombFloor = ts.V
			}
			continue
		}
		kept = append(kept, ts)
	}
	t.Tombstones = kept
}
```

- [ ] **Step 4: Run, gofmt, commit**

Run: `cd backend && gofmt -w internal/trips && go vet ./... && go test ./internal/trips/ -count=1`
Expected: PASS.

```bash
git add backend/internal/trips
git commit -m "feat(trips): delta sync and tombstone pruning

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Store interfaces and memstore fakes

**Files:**
- Modify: `backend/internal/store/repo.go` (append)
- Create: `backend/internal/testutil/memstore/trips.go`
- Modify: `backend/internal/testutil/memstore/memstore.go` (`Store` fields, `NewStore`, `Repos`, `Compose`)
- Test: `backend/internal/testutil/memstore/trips_test.go`

**Interfaces:**
- Produces:

```go
type TripStub struct {
	TripID    string     `bson:"trip_id"`
	Version   int64      `bson:"version"`
	DeletedAt *time.Time `bson:"deleted_at"`
	DeletedBy string     `bson:"deleted_by"`
}
type TripRepository interface {
	Get(ctx context.Context, tripID string) (*models.Trip, error) // derr.ErrNotFound
	Insert(ctx context.Context, t *models.Trip) error              // derr.ErrConflict on duplicate trip_id
	ReplaceCAS(ctx context.Context, t *models.Trip, expectVersion int64) (bool, error)
	Manifest(ctx context.Context, roomID string) ([]TripStub, error) // includes soft-deleted
	GetMany(ctx context.Context, roomID string, ids []string) ([]models.Trip, error)
	LinkPackingList(ctx context.Context, tripID, roomID string, expect *string, listID string, at time.Time) (bool, error)
	MoveRoom(ctx context.Context, fromRoomID, toRoomID string, at time.Time) error
	DeleteByRoom(ctx context.Context, roomID string) error
}
type PlaceCacheRepository interface {
	Get(ctx context.Context, key string) ([]models.Place, bool, error)
	Put(ctx context.Context, key string, places []models.Place, at time.Time) error
}
```
- `memstore.Repos` gains `Trips store.TripRepository` and `Places store.PlaceCacheRepository`.

- [ ] **Step 1: Write the failing test**

`backend/internal/testutil/memstore/trips_test.go`:

```go
package memstore

import (
	"context"
	"errors"
	"testing"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func sampleTrip(id, room string) *models.Trip {
	return &models.Trip{TripID: id, RoomID: room, Version: 1, FieldAt: map[string]int64{}, Acked: map[string]int64{}}
}

func TestTripRepoInsertGetClone(t *testing.T) {
	ctx := context.Background()
	r := Compose().Trips
	if err := r.Insert(ctx, sampleTrip("trip_1", "room_1")); err != nil {
		t.Fatal(err)
	}
	if err := r.Insert(ctx, sampleTrip("trip_1", "room_2")); !errors.Is(err, derr.ErrConflict) {
		t.Fatalf("want ErrConflict, got %v", err)
	}
	a, _ := r.Get(ctx, "trip_1")
	a.Title = "mutated outside the repo"
	b, _ := r.Get(ctx, "trip_1")
	if b.Title != "" {
		t.Fatalf("Get must return a copy")
	}
	if _, err := r.Get(ctx, "nope"); !errors.Is(err, derr.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

func TestTripRepoReplaceCAS(t *testing.T) {
	ctx := context.Background()
	r := Compose().Trips
	_ = r.Insert(ctx, sampleTrip("trip_1", "room_1"))
	cur, _ := r.Get(ctx, "trip_1")
	cur.Version = 2
	if ok, err := r.ReplaceCAS(ctx, cur, 1); err != nil || !ok {
		t.Fatalf("first CAS should win: ok=%v err=%v", ok, err)
	}
	stale := cur.Clone()
	stale.Version = 2
	if ok, _ := r.ReplaceCAS(ctx, stale, 1); ok {
		t.Fatalf("CAS against an old version must fail")
	}
}

func TestTripRepoManifestGetManyMoveDelete(t *testing.T) {
	ctx := context.Background()
	r := Compose().Trips
	del := time.Now()
	t2 := sampleTrip("trip_2", "room_1")
	t2.DeletedAt, t2.DeletedBy = &del, "user_x"
	_ = r.Insert(ctx, sampleTrip("trip_1", "room_1"))
	_ = r.Insert(ctx, t2)
	_ = r.Insert(ctx, sampleTrip("trip_3", "room_9"))

	stubs, _ := r.Manifest(ctx, "room_1")
	if len(stubs) != 2 {
		t.Fatalf("manifest should list both room_1 trips (incl. deleted), got %d", len(stubs))
	}
	got, _ := r.GetMany(ctx, "room_1", []string{"trip_1", "trip_3"})
	if len(got) != 1 || got[0].TripID != "trip_1" {
		t.Fatalf("GetMany must be room-scoped: %+v", got)
	}
	if err := r.MoveRoom(ctx, "room_1", "room_5", time.Now()); err != nil {
		t.Fatal(err)
	}
	moved, _ := r.Get(ctx, "trip_1")
	if moved.RoomID != "room_5" || moved.Version != 2 {
		t.Fatalf("MoveRoom should re-home and bump version: %+v", moved)
	}
	_ = r.DeleteByRoom(ctx, "room_5")
	if _, err := r.Get(ctx, "trip_1"); !errors.Is(err, derr.ErrNotFound) {
		t.Fatalf("DeleteByRoom left trips behind")
	}
	if _, err := r.Get(ctx, "trip_3"); err != nil {
		t.Fatalf("DeleteByRoom removed another room's trip")
	}
}

func TestTripRepoLinkPackingList(t *testing.T) {
	ctx := context.Background()
	r := Compose().Trips
	_ = r.Insert(ctx, sampleTrip("trip_1", "room_1"))
	if ok, _ := r.LinkPackingList(ctx, "trip_1", "room_1", nil, "list_a", time.Now()); !ok {
		t.Fatal("first link should win")
	}
	if ok, _ := r.LinkPackingList(ctx, "trip_1", "room_1", nil, "list_b", time.Now()); ok {
		t.Fatal("second link with expect=nil must lose")
	}
	old := "list_a"
	if ok, _ := r.LinkPackingList(ctx, "trip_1", "room_1", &old, "list_c", time.Now()); !ok {
		t.Fatal("relink with the right expected id should win")
	}
	got, _ := r.Get(ctx, "trip_1")
	if *got.PackingListID != "list_c" || got.Version != 3 {
		t.Fatalf("link state: %+v", got)
	}
}

func TestPlaceCacheRepo(t *testing.T) {
	ctx := context.Background()
	c := Compose().Places
	if _, ok, _ := c.Get(ctx, "k"); ok {
		t.Fatal("empty cache hit")
	}
	_ = c.Put(ctx, "k", []models.Place{{Name: "Kyoto"}}, time.Now())
	got, ok, _ := c.Get(ctx, "k")
	if !ok || len(got) != 1 || got[0].Name != "Kyoto" {
		t.Fatalf("cache roundtrip failed: %v %v", got, ok)
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && go test ./internal/testutil/memstore/ -count=1`
Expected: FAIL (build: `Compose().Trips` undefined).

- [ ] **Step 3: Add the interfaces to `repo.go`** (append; the file already imports `context`, `time` and `models`)

```go
// TripStub is the manifest projection used by sync.
type TripStub struct {
	TripID    string     `bson:"trip_id"`
	Version   int64      `bson:"version"`
	DeletedAt *time.Time `bson:"deleted_at"`
	DeletedBy string     `bson:"deleted_by"`
}

type TripRepository interface {
	// Get returns derr.ErrNotFound when the trip does not exist.
	Get(ctx context.Context, tripID string) (*models.Trip, error)
	// Insert returns derr.ErrConflict when trip_id already exists.
	Insert(ctx context.Context, t *models.Trip) error
	// ReplaceCAS replaces the stored trip only if its version still equals expectVersion.
	ReplaceCAS(ctx context.Context, t *models.Trip, expectVersion int64) (bool, error)
	// Manifest lists id/version/deleted state of every trip in the room (including soft-deleted).
	Manifest(ctx context.Context, roomID string) ([]TripStub, error)
	GetMany(ctx context.Context, roomID string, ids []string) ([]models.Trip, error)
	// LinkPackingList sets packing_list_id (and bumps version) only if it currently equals expect (nil = unset).
	LinkPackingList(ctx context.Context, tripID, roomID string, expect *string, listID string, at time.Time) (bool, error)
	// MoveRoom re-homes every trip of fromRoomID into toRoomID and bumps their version.
	MoveRoom(ctx context.Context, fromRoomID, toRoomID string, at time.Time) error
	DeleteByRoom(ctx context.Context, roomID string) error
}

// PlaceCacheRepository caches geocoder results (TTL-expired by the datastore).
type PlaceCacheRepository interface {
	Get(ctx context.Context, key string) ([]models.Place, bool, error)
	Put(ctx context.Context, key string, places []models.Place, at time.Time) error
}
```

- [ ] **Step 4: Implement the fakes** — `backend/internal/testutil/memstore/trips.go`:

```go
package memstore

import (
	"context"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
)

// TripRepo is the in-memory store.TripRepository. It copies on the way in and out
// so callers can't mutate stored state, mirroring a real datastore.
type TripRepo struct{ st *Store }

func (r *TripRepo) Get(_ context.Context, id string) (*models.Trip, error) {
	r.st.mu.RLock()
	defer r.st.mu.RUnlock()
	t, ok := r.st.trips[id]
	if !ok {
		return nil, derr.ErrNotFound
	}
	return t.Clone(), nil
}

func (r *TripRepo) Insert(_ context.Context, t *models.Trip) error {
	r.st.mu.Lock()
	defer r.st.mu.Unlock()
	if _, ok := r.st.trips[t.TripID]; ok {
		return derr.ErrConflict
	}
	r.st.trips[t.TripID] = t.Clone()
	return nil
}

func (r *TripRepo) ReplaceCAS(_ context.Context, t *models.Trip, expect int64) (bool, error) {
	r.st.mu.Lock()
	defer r.st.mu.Unlock()
	cur, ok := r.st.trips[t.TripID]
	if !ok || cur.Version != expect {
		return false, nil
	}
	r.st.trips[t.TripID] = t.Clone()
	return true, nil
}

func (r *TripRepo) Manifest(_ context.Context, roomID string) ([]store.TripStub, error) {
	r.st.mu.RLock()
	defer r.st.mu.RUnlock()
	var out []store.TripStub
	for _, t := range r.st.trips {
		if t.RoomID == roomID {
			out = append(out, store.TripStub{TripID: t.TripID, Version: t.Version, DeletedAt: t.DeletedAt, DeletedBy: t.DeletedBy})
		}
	}
	return out, nil
}

func (r *TripRepo) GetMany(_ context.Context, roomID string, ids []string) ([]models.Trip, error) {
	r.st.mu.RLock()
	defer r.st.mu.RUnlock()
	var out []models.Trip
	for _, id := range ids {
		if t, ok := r.st.trips[id]; ok && t.RoomID == roomID {
			out = append(out, *t.Clone())
		}
	}
	return out, nil
}

func (r *TripRepo) LinkPackingList(_ context.Context, tripID, roomID string, expect *string, listID string, at time.Time) (bool, error) {
	r.st.mu.Lock()
	defer r.st.mu.Unlock()
	t, ok := r.st.trips[tripID]
	if !ok || t.RoomID != roomID || t.DeletedAt != nil {
		return false, nil
	}
	if (expect == nil) != (t.PackingListID == nil) || (expect != nil && *expect != *t.PackingListID) {
		return false, nil
	}
	id := listID
	t.PackingListID = &id
	t.Version++
	t.V = t.Version
	t.UpdatedAt = at
	return true, nil
}

func (r *TripRepo) MoveRoom(_ context.Context, from, to string, at time.Time) error {
	r.st.mu.Lock()
	defer r.st.mu.Unlock()
	for _, t := range r.st.trips {
		if t.RoomID == from {
			t.RoomID = to
			t.Version++
			t.V = t.Version
			t.UpdatedAt = at
		}
	}
	return nil
}

func (r *TripRepo) DeleteByRoom(_ context.Context, roomID string) error {
	r.st.mu.Lock()
	defer r.st.mu.Unlock()
	for id, t := range r.st.trips {
		if t.RoomID == roomID {
			delete(r.st.trips, id)
		}
	}
	return nil
}

// PlaceCacheRepo is the in-memory store.PlaceCacheRepository (no TTL in tests).
type PlaceCacheRepo struct{ st *Store }

func (r *PlaceCacheRepo) Get(_ context.Context, key string) ([]models.Place, bool, error) {
	r.st.mu.RLock()
	defer r.st.mu.RUnlock()
	p, ok := r.st.places[key]
	return append([]models.Place(nil), p...), ok, nil
}

func (r *PlaceCacheRepo) Put(_ context.Context, key string, places []models.Place, _ time.Time) error {
	r.st.mu.Lock()
	defer r.st.mu.Unlock()
	r.st.places[key] = append([]models.Place(nil), places...)
	return nil
}
```

In `memstore.go`: add to `Store` the fields `trips map[string]*models.Trip` and `places map[string][]models.Place`; initialise both in `NewStore()`; extend `Repos` with `Trips store.TripRepository` and `Places store.PlaceCacheRepository`; and in `Compose()` add `Trips: &TripRepo{st}, Places: &PlaceCacheRepo{st}` (the `st` variable is already there).

- [ ] **Step 5: Run, gofmt, commit**

Run: `cd backend && gofmt -w internal && go vet ./... && go test ./... -count=1`
Expected: PASS.

```bash
git add backend/internal
git commit -m "feat(trips): store interfaces and in-memory fakes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: `TripService` — `ApplyOps` and `Sync`

**Files:**
- Create: `backend/internal/services/trip_service.go`
- Test: `backend/internal/services/trip_service_test.go`
- Modify: `backend/internal/errors/errors.go` (add `ErrRateLimited`, used in Tasks 15–16)

**Interfaces:**
- Consumes: `trips.DecodeOp/ApplyOp/DeltaSince/PruneTombstones/NewShell`, `store.TripRepository`, `ensureRoomMembership`.
- Produces:

```go
type OpsResponse struct {
	ServerTime int64             `json:"server_time"`
	Results    []models.OpResult `json:"results"`
	Trips      []models.TripDelta `json:"trips"`
}
type SyncResponse struct {
	ServerTime int64               `json:"server_time"`
	Trips      []models.TripDelta  `json:"trips"`
	Removed    []models.RemovedTrip `json:"removed"`
}
func NewTripService(rooms store.RoomRepository, trips store.TripRepository, lists *ListService, listRepo store.ListRepository) *TripService
func (s *TripService) ApplyOps(ctx context.Context, user *models.User, roomID string, raws []json.RawMessage) (*OpsResponse, error)
func (s *TripService) Sync(ctx context.Context, user *models.User, roomID string, known map[string]int64) (*SyncResponse, error)
const MaxOpsPerBatch = 200; const MaxKnownTrips = 500
```
- `derr.ErrRateLimited = errors.New("rate limited")`.

- [ ] **Step 1: Add the sentinel**

In `internal/errors/errors.go` add inside the `var` block: `ErrRateLimited = errors.New("rate limited")`.

- [ ] **Step 2: Write the failing tests**

`backend/internal/services/trip_service_test.go`:

```go
package services

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/services/categorization"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

var svcTripID = "trip_" + strings.Repeat("a", 32)

func svcTodoID(c string) string { return "ttd_" + strings.Repeat(c, 32) }

type tripEnv struct {
	svc   *TripService
	repos memstore.Repos
	ua    *models.User
	ub    *models.User
	uc    *models.User // member of a different room
}

func newTripEnv(t *testing.T) *tripEnv {
	t.Helper()
	ctx := context.Background()
	m := memstore.Compose()
	r1, r2 := "room_1", "room_2"
	_ = m.Rooms.Put(ctx, &models.Room{RoomID: r1, MemberIDs: []string{"user_a", "user_b"}})
	_ = m.Rooms.Put(ctx, &models.Room{RoomID: r2, MemberIDs: []string{"user_c"}})
	listSvc := NewListService(m.Users, m.Rooms, m.Lists, m.Items, categorization.NewKeywordCategorizer(categorization.GroceryAnchors))
	return &tripEnv{
		svc:   NewTripService(m.Rooms, m.Trips, listSvc, m.Lists),
		repos: m,
		ua:    &models.User{UserID: "user_a", RoomID: &r1},
		ub:    &models.User{UserID: "user_b", RoomID: &r1},
		uc:    &models.User{UserID: "user_c", RoomID: &r2},
	}
}

func opJSON(t *testing.T, client string, seq int64, typ, entity string, patch map[string]any) json.RawMessage {
	t.Helper()
	m := map[string]any{"v": 1, "op_id": "op-" + client + "-" + string(rune('a'+seq)), "client_id": client, "seq": seq,
		"at": time.Now().UnixMilli() - 1000, "type": typ, "trip_id": svcTripID}
	if entity != "" {
		m["entity_id"] = entity
	}
	if patch != nil {
		m["patch"] = patch
	}
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func createBatch(t *testing.T) []json.RawMessage {
	return []json.RawMessage{
		opJSON(t, "dev-a", 1, "trip.create", "", map[string]any{"title": "Japan"}),
		opJSON(t, "dev-a", 2, "todo.create", svcTodoID("1"), map[string]any{"title": "Ramen"}),
	}
}

func TestApplyOpsCreatesTripAndTodoInOneBatch(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	resp, err := e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range resp.Results {
		if r.Status != models.OpApplied {
			t.Fatalf("results: %+v", resp.Results)
		}
	}
	if len(resp.Trips) != 1 || !resp.Trips[0].Full || resp.Trips[0].Version != 1 || len(resp.Trips[0].Todos) != 1 {
		t.Fatalf("deltas: %+v", resp.Trips)
	}
	stored, _ := e.repos.Trips.Get(ctx, svcTripID)
	if stored.CreatedBy != "user_a" || stored.RoomID != "room_1" {
		t.Fatalf("stored: %+v", stored)
	}
}

func TestApplyOpsRetriedBatchIsDuplicateNotConflict(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	_, _ = e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))
	resp, err := e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range resp.Results {
		if r.Status != models.OpDuplicate {
			t.Fatalf("retry should be duplicate: %+v", resp.Results)
		}
	}
	if len(resp.Trips) != 0 {
		t.Fatalf("a pure replay changes nothing, got deltas: %+v", resp.Trips)
	}
}

func TestApplyOpsAccessControl(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	_, _ = e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))
	// not a member of room_1
	if _, err := e.svc.ApplyOps(ctx, e.uc, "room_1", createBatch(t)); !errors.Is(err, derr.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
	// member of room_2 targeting a room_1 trip id through their own room: indistinguishable from "unknown"
	resp, err := e.svc.ApplyOps(ctx, e.uc, "room_2", []json.RawMessage{
		opJSON(t, "dev-c", 1, "todo.create", svcTodoID("2"), map[string]any{"title": "sneaky"}),
	})
	if err != nil {
		t.Fatal(err)
	}
	if r := resp.Results[0]; r.Status != models.OpRejected || r.Code != models.CodeForbiddenOrUnknown {
		t.Fatalf("got %+v", r)
	}
	stored, _ := e.repos.Trips.Get(ctx, svcTripID)
	if len(stored.Todos) != 1 {
		t.Fatalf("cross-room write leaked: %+v", stored.Todos)
	}
}

func TestApplyOpsOneBadOpDoesNotFailTheBatch(t *testing.T) {
	e := newTripEnv(t)
	raws := append(createBatch(t), json.RawMessage(`{"op_id":"op-bad","v":1,"mystery":true}`))
	resp, err := e.svc.ApplyOps(context.Background(), e.ua, "room_1", raws)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Results[0].Status != models.OpApplied || resp.Results[2].Status != models.OpRejected ||
		resp.Results[2].Code != models.CodeUnsupported || resp.Results[2].OpID != "op-bad" {
		t.Fatalf("results: %+v", resp.Results)
	}
}

func TestApplyOpsBatchBounds(t *testing.T) {
	e := newTripEnv(t)
	if _, err := e.svc.ApplyOps(context.Background(), e.ua, "room_1", nil); !errors.Is(err, derr.ErrBadRequest) {
		t.Fatalf("empty batch: %v", err)
	}
	many := make([]json.RawMessage, MaxOpsPerBatch+1)
	for i := range many {
		many[i] = json.RawMessage(`{}`)
	}
	if _, err := e.svc.ApplyOps(context.Background(), e.ua, "room_1", many); !errors.Is(err, derr.ErrBadRequest) {
		t.Fatalf("oversized batch: %v", err)
	}
}

// racyRepo lets a "concurrent writer" slip in before our compare-and-swap.
type racyRepo struct {
	store.TripRepository
	always bool
	fired  bool
	sneak  func()
}

func (r *racyRepo) ReplaceCAS(ctx context.Context, t *models.Trip, expect int64) (bool, error) {
	if r.always || !r.fired {
		r.fired = true
		r.sneak()
	}
	return r.TripRepository.ReplaceCAS(ctx, t, expect)
}

func sneakNotes(inner store.TripRepository) func() {
	return func() {
		ctx := context.Background()
		cur, _ := inner.Get(ctx, svcTripID)
		prev := cur.Version
		cur.Notes = "written by someone else"
		cur.Version++
		_, _ = inner.ReplaceCAS(ctx, cur, prev)
	}
}

func TestApplyOpsRetriesOnCASConflictAndKeepsBothWrites(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	_, _ = e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))
	racy := &racyRepo{TripRepository: e.repos.Trips}
	racy.sneak = sneakNotes(e.repos.Trips)
	e.svc.trips = racy

	resp, err := e.svc.ApplyOps(ctx, e.ub, "room_1", []json.RawMessage{
		opJSON(t, "dev-b", 1, "todo.update", svcTodoID("1"), map[string]any{"done": true}),
	})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Results[0].Status != models.OpApplied {
		t.Fatalf("results: %+v", resp.Results)
	}
	stored, _ := e.repos.Trips.Get(ctx, svcTripID)
	if stored.Notes != "written by someone else" || !stored.Todos[0].Done {
		t.Fatalf("lost an update: notes=%q done=%v", stored.Notes, stored.Todos[0].Done)
	}
}

func TestApplyOpsGivesRetryWhenCASKeepsLosing(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	_, _ = e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))
	racy := &racyRepo{TripRepository: e.repos.Trips, always: true}
	racy.sneak = sneakNotes(e.repos.Trips)
	e.svc.trips = racy

	resp, err := e.svc.ApplyOps(ctx, e.ub, "room_1", []json.RawMessage{
		opJSON(t, "dev-b", 1, "todo.update", svcTodoID("1"), map[string]any{"done": true}),
	})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Results[0].Status != models.OpRetry {
		t.Fatalf("want retry, got %+v", resp.Results)
	}
}

func TestSyncFullDeltaUnchangedRemovedAndPurged(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	_, _ = e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))

	s, err := e.svc.Sync(ctx, e.ub, "room_1", map[string]int64{})
	if err != nil || len(s.Trips) != 1 || !s.Trips[0].Full || len(s.Removed) != 0 {
		t.Fatalf("new device: %+v %v", s, err)
	}
	s, _ = e.svc.Sync(ctx, e.ub, "room_1", map[string]int64{svcTripID: 1})
	if len(s.Trips) != 0 || len(s.Removed) != 0 {
		t.Fatalf("up to date client should get nothing: %+v", s)
	}
	// soft delete -> client that has the trip is told to drop it (restorable), with who did it
	_, _ = e.svc.ApplyOps(ctx, e.ua, "room_1", []json.RawMessage{opJSON(t, "dev-a", 3, "trip.delete", "", nil)})
	s, _ = e.svc.Sync(ctx, e.ub, "room_1", map[string]int64{svcTripID: 1})
	if len(s.Removed) != 1 || s.Removed[0].DeletedBy != "user_a" || s.Removed[0].Purged {
		t.Fatalf("soft delete: %+v", s.Removed)
	}
	// a client that never had it doesn't hear about it at all
	s, _ = e.svc.Sync(ctx, e.ub, "room_1", map[string]int64{})
	if len(s.Trips) != 0 || len(s.Removed) != 0 {
		t.Fatalf("unknown deleted trip leaked: %+v", s)
	}
	// ids the server no longer has are reported as purged
	s, _ = e.svc.Sync(ctx, e.ub, "room_1", map[string]int64{"trip_" + strings.Repeat("f", 32): 5})
	if len(s.Removed) != 1 || !s.Removed[0].Purged {
		t.Fatalf("purged: %+v", s.Removed)
	}
}

func TestSyncBoundsAndAccess(t *testing.T) {
	e := newTripEnv(t)
	known := map[string]int64{}
	for i := 0; i <= MaxKnownTrips; i++ {
		known[fmt.Sprintf("trip_%032x", i)] = 1
	}
	if _, err := e.svc.Sync(context.Background(), e.ua, "room_1", known); !errors.Is(err, derr.ErrBadRequest) {
		t.Fatalf("too many known: %v", err)
	}
	if _, err := e.svc.Sync(context.Background(), e.uc, "room_1", nil); !errors.Is(err, derr.ErrForbidden) {
		t.Fatalf("non-member: %v", err)
	}
}
```

Add `"fmt"` to this test file's import block (used by `TestSyncBoundsAndAccess`).

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && go test ./internal/services/ -run 'ApplyOps|Sync' -count=1`
Expected: FAIL (undefined: TripService).

- [ ] **Step 4: Implement `trip_service.go`**

```go
package services

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
	"github.com/janvillarosa/gracie-app/backend/internal/trips"
)

const (
	MaxOpsPerBatch = 200
	MaxKnownTrips  = 500
	maxCASAttempts = 3
)

type OpsResponse struct {
	ServerTime int64              `json:"server_time"`
	Results    []models.OpResult  `json:"results"`
	Trips      []models.TripDelta `json:"trips"`
}

type SyncResponse struct {
	ServerTime int64                `json:"server_time"`
	Trips      []models.TripDelta   `json:"trips"`
	Removed    []models.RemovedTrip `json:"removed"`
}

type TripService struct {
	rooms    store.RoomRepository
	trips    store.TripRepository
	lists    *ListService
	listRepo store.ListRepository
	now      func() time.Time
}

func NewTripService(rooms store.RoomRepository, tripRepo store.TripRepository, lists *ListService, listRepo store.ListRepository) *TripService {
	return &TripService{rooms: rooms, trips: tripRepo, lists: lists, listRepo: listRepo, now: time.Now}
}

// ApplyOps applies a batch of client ops. Each op gets its own result; the batch only
// fails as a whole for auth problems or a malformed request.
func (s *TripService) ApplyOps(ctx context.Context, user *models.User, roomID string, raws []json.RawMessage) (*OpsResponse, error) {
	if err := ensureRoomMembership(ctx, s.rooms, user, roomID); err != nil {
		return nil, err
	}
	if len(raws) == 0 || len(raws) > MaxOpsPerBatch {
		return nil, derr.ErrBadRequest
	}
	now := s.now().UTC()
	results := make([]models.OpResult, len(raws))
	ops := make([]models.Op, len(raws))
	groups := map[string][]int{}
	var order []string
	for i, raw := range raws {
		op, rejected, ok := trips.DecodeOp(raw)
		if !ok {
			results[i] = rejected
			continue
		}
		ops[i] = op
		if _, seen := groups[op.TripID]; !seen {
			order = append(order, op.TripID)
		}
		groups[op.TripID] = append(groups[op.TripID], i)
	}
	deltas := []models.TripDelta{}
	for _, id := range order {
		d, err := s.applyGroup(ctx, user, roomID, now, ops, groups[id], results)
		if err != nil {
			return nil, err
		}
		if d != nil {
			deltas = append(deltas, *d)
		}
	}
	return &OpsResponse{ServerTime: now.UnixMilli(), Results: results, Trips: deltas}, nil
}

// applyGroup applies the ops of one trip with a compare-and-swap retry loop.
func (s *TripService) applyGroup(ctx context.Context, user *models.User, roomID string, now time.Time, ops []models.Op, idx []int, results []models.OpResult) (*models.TripDelta, error) {
	tripID := ops[idx[0]].TripID
	for attempt := 0; attempt < maxCASAttempts; attempt++ {
		t, err := s.trips.Get(ctx, tripID)
		isNew := false
		switch {
		case errors.Is(err, derr.ErrNotFound):
			t, isNew = trips.NewShell(tripID, roomID, user.UserID, now), true
		case err != nil:
			return nil, err
		case t.RoomID != roomID:
			// Same answer as an unknown trip, so existence in other houses is not revealed.
			for _, i := range idx {
				results[i] = models.OpResult{OpID: ops[i].OpID, Status: models.OpRejected, Code: models.CodeForbiddenOrUnknown}
			}
			return nil, nil
		}
		base := t.Version
		c := trips.Ctx{Actor: user.UserID, Now: now, NewV: base + 1}
		dirty, bump := false, false
		for _, i := range idx {
			r, o := trips.ApplyOp(t, ops[i], c)
			results[i] = r
			dirty, bump = dirty || o.Dirty, bump || o.Bump
		}
		if !dirty || (isNew && !bump) {
			return nil, nil
		}
		trips.PruneTombstones(t, now)
		if bump {
			t.UpdatedAt = now
		}
		if isNew {
			if err := s.trips.Insert(ctx, t); err != nil {
				if errors.Is(err, derr.ErrConflict) {
					continue // lost a create race: reload and apply against the winner
				}
				return nil, err
			}
		} else {
			ok, err := s.trips.ReplaceCAS(ctx, t, base)
			if err != nil {
				return nil, err
			}
			if !ok {
				continue
			}
		}
		if !bump {
			return nil, nil
		}
		var d models.TripDelta
		if isNew {
			d = trips.DeltaSince(t, 0, false)
		} else {
			d = trips.DeltaSince(t, base, true)
		}
		return &d, nil
	}
	for _, i := range idx {
		results[i] = models.OpResult{OpID: ops[i].OpID, Status: models.OpRetry}
	}
	return nil, nil
}

// Sync returns per-trip deltas for everything that differs from the client's known versions.
func (s *TripService) Sync(ctx context.Context, user *models.User, roomID string, known map[string]int64) (*SyncResponse, error) {
	if err := ensureRoomMembership(ctx, s.rooms, user, roomID); err != nil {
		return nil, err
	}
	if len(known) > MaxKnownTrips {
		return nil, derr.ErrBadRequest
	}
	stubs, err := s.trips.Manifest(ctx, roomID)
	if err != nil {
		return nil, err
	}
	resp := &SyncResponse{ServerTime: s.now().UnixMilli(), Trips: []models.TripDelta{}, Removed: []models.RemovedTrip{}}
	onServer := map[string]bool{}
	var need []string
	for _, st := range stubs {
		onServer[st.TripID] = true
		kv, has := known[st.TripID]
		if st.DeletedAt != nil {
			if has {
				resp.Removed = append(resp.Removed, models.RemovedTrip{TripID: st.TripID, DeletedBy: st.DeletedBy})
			}
			continue
		}
		if has && kv == st.Version {
			continue
		}
		need = append(need, st.TripID)
	}
	for id := range known {
		if !onServer[id] {
			resp.Removed = append(resp.Removed, models.RemovedTrip{TripID: id, Purged: true})
		}
	}
	if len(need) > 0 {
		full, err := s.trips.GetMany(ctx, roomID, need)
		if err != nil {
			return nil, err
		}
		for i := range full {
			kv, has := known[full[i].TripID]
			resp.Trips = append(resp.Trips, trips.DeltaSince(&full[i], kv, has))
		}
	}
	sort.Slice(resp.Trips, func(a, b int) bool { return resp.Trips[a].TripID < resp.Trips[b].TripID })
	sort.Slice(resp.Removed, func(a, b int) bool { return resp.Removed[a].TripID < resp.Removed[b].TripID })
	return resp, nil
}
```

- [ ] **Step 5: Run, gofmt, commit**

Run: `cd backend && gofmt -w internal && go vet ./... && go test ./... -count=1`
Expected: PASS.

```bash
git add backend/internal
git commit -m "feat(trips): TripService ApplyOps with CAS retry and delta Sync

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Packing list link

**Files:**
- Modify: `backend/internal/services/trip_service.go` (append)
- Test: `backend/internal/services/trip_packing_test.go`

**Interfaces:**
- Produces: `func (s *TripService) EnsurePackingList(ctx context.Context, user *models.User, roomID, tripID string) (*models.List, error)` — idempotent; creates the List "Packing · <title>" and links it with a compare-and-swap; on losing the race it deletes the List it created and returns the winner; a link to a missing or soft-deleted List is repaired by relinking.
- Uses `ListService.CreateList(ctx, user, roomID, name, description, icon)` and `store.ListRepository.GetByID/Delete`.

- [ ] **Step 1: Write the failing tests**

`backend/internal/services/trip_packing_test.go`:

```go
package services

import (
	"context"
	"errors"
	"testing"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
)

func TestEnsurePackingListCreatesOnceAndIsIdempotent(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	_, _ = e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))

	l1, err := e.svc.EnsurePackingList(ctx, e.ua, "room_1", svcTripID)
	if err != nil || l1.Name != "Packing · Japan" {
		t.Fatalf("first call: %+v %v", l1, err)
	}
	l2, err := e.svc.EnsurePackingList(ctx, e.ub, "room_1", svcTripID)
	if err != nil || l2.ListID != l1.ListID {
		t.Fatalf("second call must return the same list: %+v %v", l2, err)
	}
	lists, _ := e.repos.Lists.ListByRoom(ctx, "room_1")
	if len(lists) != 1 {
		t.Fatalf("want exactly one list, got %d", len(lists))
	}
}

type racyLink struct {
	store.TripRepository
	winner string
	fired  bool
	inner  store.TripRepository
}

func (r *racyLink) LinkPackingList(ctx context.Context, tripID, roomID string, expect *string, listID string, at time.Time) (bool, error) {
	if !r.fired {
		r.fired = true
		_, _ = r.inner.LinkPackingList(ctx, tripID, roomID, nil, r.winner, at) // someone else links first
	}
	return r.TripRepository.LinkPackingList(ctx, tripID, roomID, expect, listID, at)
}

func TestEnsurePackingListRaceLeavesOneList(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	_, _ = e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))
	_ = e.repos.Lists.Put(ctx, &models.List{ListID: "list_winner", RoomID: "room_1", Name: "Packing · Japan"})
	e.svc.trips = &racyLink{TripRepository: e.repos.Trips, inner: e.repos.Trips, winner: "list_winner"}

	got, err := e.svc.EnsurePackingList(ctx, e.ua, "room_1", svcTripID)
	if err != nil || got.ListID != "list_winner" {
		t.Fatalf("loser must return the winner's list: %+v %v", got, err)
	}
	lists, _ := e.repos.Lists.ListByRoom(ctx, "room_1")
	if len(lists) != 1 || lists[0].ListID != "list_winner" {
		t.Fatalf("the losing list must be deleted: %+v", lists)
	}
}

func TestEnsurePackingListRepairsLinkToDeletedList(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	_, _ = e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))
	l1, _ := e.svc.EnsurePackingList(ctx, e.ua, "room_1", svcTripID)
	_ = e.repos.Lists.Delete(ctx, l1.ListID)

	l2, err := e.svc.EnsurePackingList(ctx, e.ua, "room_1", svcTripID)
	if err != nil || l2.ListID == l1.ListID {
		t.Fatalf("expected a fresh list after the old one vanished: %+v %v", l2, err)
	}
}

func TestEnsurePackingListAccessAndMissingTrip(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	_, _ = e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))
	if _, err := e.svc.EnsurePackingList(ctx, e.uc, "room_1", svcTripID); !errors.Is(err, derr.ErrForbidden) {
		t.Fatalf("non-member: %v", err)
	}
	if _, err := e.svc.EnsurePackingList(ctx, e.uc, "room_2", svcTripID); !errors.Is(err, derr.ErrNotFound) {
		t.Fatalf("trip from another room must look missing: %v", err)
	}
	if _, err := e.svc.EnsurePackingList(ctx, e.ua, "room_1", "trip_"+"b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0"); !errors.Is(err, derr.ErrNotFound) {
		t.Fatalf("unknown trip: %v", err)
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && go test ./internal/services/ -run PackingList -count=1`
Expected: FAIL (undefined: EnsurePackingList).

- [ ] **Step 3: Implement** — append to `trip_service.go`:

```go
// EnsurePackingList returns the trip's linked packing List, creating and linking it if needed.
// Online-only by design. Linking is a compare-and-swap, so concurrent callers end up
// sharing one List: the loser deletes the List it just created and returns the winner's.
func (s *TripService) EnsurePackingList(ctx context.Context, user *models.User, roomID, tripID string) (*models.List, error) {
	if err := ensureRoomMembership(ctx, s.rooms, user, roomID); err != nil {
		return nil, err
	}
	t, err := s.trips.Get(ctx, tripID)
	if err != nil {
		return nil, err
	}
	if t.RoomID != roomID || t.DeletedAt != nil {
		return nil, derr.ErrNotFound
	}
	if t.PackingListID != nil {
		if l, err := s.listRepo.GetByID(ctx, *t.PackingListID); err == nil && !l.IsDeleted {
			return l, nil
		}
		// stale link: fall through and relink, expecting the stale id
	}
	created, err := s.lists.CreateList(ctx, user, roomID, "Packing · "+t.Title, "", "")
	if err != nil {
		return nil, err
	}
	won, err := s.trips.LinkPackingList(ctx, tripID, roomID, t.PackingListID, created.ListID, s.now().UTC())
	if err != nil {
		_ = s.listRepo.Delete(ctx, created.ListID)
		return nil, err
	}
	if won {
		return created, nil
	}
	_ = s.listRepo.Delete(ctx, created.ListID)
	cur, err := s.trips.Get(ctx, tripID)
	if err != nil {
		return nil, err
	}
	if cur.PackingListID == nil {
		return nil, derr.ErrConflict
	}
	return s.listRepo.GetByID(ctx, *cur.PackingListID)
}
```

Check `CreateList`'s validation of empty icon/description in `list_service.go:56`; if an empty icon is rejected, pass the default icon constant that file uses.

- [ ] **Step 4: Run, gofmt, commit**

Run: `cd backend && gofmt -w internal && go vet ./... && go test ./internal/services/ -count=1`
Expected: PASS.

```bash
git add backend/internal
git commit -m "feat(trips): linked packing list with compare-and-swap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Room and user lifecycle

**Files:**
- Modify: `backend/internal/services/room_service.go` (struct, `UseTripRepo`, `JoinRoom` tx, `cleanupRoomResources`)
- Modify: `backend/internal/services/user_service.go` (struct, `UseTripRepo`, `cleanupRoomResources`)
- Test: `backend/internal/services/trip_lifecycle_test.go`

**Interfaces:**
- Produces: `func (s *RoomService) UseTripRepo(trips store.TripRepository)` and `func (s *UserService) UseTripRepo(trips store.TripRepository)`.

- [ ] **Step 1: Write the failing tests**

`backend/internal/services/trip_lifecycle_test.go`:

```go
package services

import (
	"context"
	"errors"
	"testing"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

func TestJoinRoomMovesSoloTripsAndCleanupDeletesTrips(t *testing.T) {
	ctx := context.Background()
	m := memstore.Compose()
	us := NewUserService(m.Users, m.Rooms, m.Tx)
	rs := NewRoomService(m.Users, m.Rooms, m.Tx)
	rs.UseListRepos(m.Lists, m.Items)
	rs.UseTripRepo(m.Trips)

	a, _ := us.CreateUserWithSoloRoom(ctx, "A")
	b, _ := us.CreateUserWithSoloRoom(ctx, "B")
	bSolo := *b.User.RoomID
	now := time.Now().UTC()
	_ = m.Trips.Insert(ctx, &models.Trip{TripID: "trip_b", RoomID: bSolo, Version: 1, CreatedAt: now, UpdatedAt: now})

	tok, err := rs.RotateShareToken(ctx, a.User)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := rs.JoinRoom(ctx, b.User, *a.User.RoomID, tok); err != nil {
		t.Fatal(err)
	}
	moved, err := m.Trips.Get(ctx, "trip_b")
	if err != nil || moved.RoomID != *a.User.RoomID || moved.Version != 2 {
		t.Fatalf("solo trip should move into the shared house and bump version: %+v %v", moved, err)
	}

	rs.cleanupRoomResources(ctx, *a.User.RoomID)
	if _, err := m.Trips.Get(ctx, "trip_b"); !errors.Is(err, derr.ErrNotFound) {
		t.Fatalf("room cleanup must delete its trips, got %v", err)
	}
}

func TestUserServiceCleanupDeletesTrips(t *testing.T) {
	ctx := context.Background()
	m := memstore.Compose()
	us := NewUserService(m.Users, m.Rooms, m.Tx)
	us.UseListRepos(m.Lists, m.Items)
	us.UseTripRepo(m.Trips)
	_ = m.Trips.Insert(ctx, &models.Trip{TripID: "trip_x", RoomID: "room_z", Version: 1})
	us.cleanupRoomResources(ctx, "room_z")
	if _, err := m.Trips.Get(ctx, "trip_x"); !errors.Is(err, derr.ErrNotFound) {
		t.Fatalf("user-service cleanup must delete trips, got %v", err)
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && go test ./internal/services/ -run 'JoinRoomMoves|UserServiceCleanup' -count=1`
Expected: FAIL (undefined: UseTripRepo).

- [ ] **Step 3: Implement**

`room_service.go`: add `trips store.TripRepository` to the `RoomService` struct and

```go
// UseTripRepo injects the optional trip repository used to re-home and clean up trips.
func (s *RoomService) UseTripRepo(trips store.TripRepository) { s.trips = trips }
```

In `JoinRoom`, inside the transaction closure, replace the `if deleteSolo != nil { return s.rooms.Delete(...) }` tail with:

```go
		if deleteSolo != nil {
			if s.trips != nil {
				// keep the joiner's solo-room trips: they follow the user into the shared house
				if err := s.trips.MoveRoom(txctx, deleteSolo.RoomID, rm.RoomID, now); err != nil {
					return err
				}
			}
			return s.rooms.Delete(txctx, deleteSolo.RoomID)
		}
		return nil
```

Replace `cleanupRoomResources` in `room_service.go` with:

```go
func (s *RoomService) cleanupRoomResources(ctx context.Context, roomID string) {
	if s.trips != nil {
		_ = s.trips.DeleteByRoom(ctx, roomID)
	}
	if s.lists == nil {
		return
	}
	lists, err := s.lists.ListByRoom(ctx, roomID)
	if err != nil {
		return
	}
	for _, l := range lists {
		_ = s.lists.Delete(ctx, l.ListID)
	}
}
```

`user_service.go`: add the `trips store.TripRepository` field, the same `UseTripRepo` method on `UserService`, and the identical `if s.trips != nil { _ = s.trips.DeleteByRoom(ctx, roomID) }` as the first statement of its `cleanupRoomResources` (before the `if s.lists == nil` early return).

- [ ] **Step 4: Run, commit**

Run: `cd backend && gofmt -l internal; go vet ./... && go test ./... -count=1` then `make check` from the repo root.
Expected: PASS.

```bash
git add backend/internal
git commit -m "feat(trips): re-home trips on join and clean up with the room

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Mongo repositories + integration tests

**Files:**
- Create: `backend/internal/store/mongo/trip_repo.go`, `backend/internal/store/mongo/place_cache_repo.go`
- Modify: `backend/internal/store/mongo/mongo_integration_test.go` (append tests; keep the `//go:build integration` tag)
- Modify: `backend/internal/store/CLAUDE.md` (document the two collections and indexes — one short paragraph)

**Interfaces:**
- Produces: `mongo.NewTripRepo(c *Client) *TripRepo` and `mongo.NewPlaceCacheRepo(c *Client) *PlaceCacheRepo`, both with `EnsureIndexes(ctx) error`, implementing `store.TripRepository` / `store.PlaceCacheRepository`.

- [ ] **Step 1: Write the failing integration tests** (append to `mongo_integration_test.go`; add imports `errors`, `encoding/json`, `strings` as needed)

```go
func newTestTrip(id, room string) *models.Trip {
	now := time.Now().UTC()
	return &models.Trip{TripID: id, RoomID: room, Version: 1, V: 1, FieldAt: map[string]int64{}, Acked: map[string]int64{},
		TripFields: models.TripFields{Title: "Japan"}, CreatedBy: "user_a", CreatedAt: now, UpdatedAt: now}
}

func TestMongoTripRepoCASInsertAndIndexes(t *testing.T) {
	c := connectOrSkip(t)
	r := NewTripRepo(c)
	ctx := context.Background()
	if err := r.EnsureIndexes(ctx); err != nil {
		t.Fatalf("indexes: %v", err)
	}
	id := "trip_" + randHex(16)
	if err := r.Insert(ctx, newTestTrip(id, "room_1")); err != nil {
		t.Fatal(err)
	}
	if err := r.Insert(ctx, newTestTrip(id, "room_2")); !errors.Is(err, derr.ErrConflict) {
		t.Fatalf("duplicate insert should be ErrConflict, got %v", err)
	}
	cur, _ := r.Get(ctx, id)
	cur.Version = 2
	cur.Title = "Japan 2026"
	if ok, err := r.ReplaceCAS(ctx, cur, 1); err != nil || !ok {
		t.Fatalf("CAS should win: %v %v", ok, err)
	}
	stale := cur.Clone()
	stale.Version = 2
	if ok, _ := r.ReplaceCAS(ctx, stale, 1); ok {
		t.Fatalf("stale CAS must lose")
	}
	got, _ := r.Get(ctx, id)
	if got.Title != "Japan 2026" || got.Version != 2 {
		t.Fatalf("stored: %+v", got)
	}

	// TTL index on purge_at exists
	cur2, _ := r.Get(ctx, id)
	idxs, _ := r.col().Indexes().List(ctx)
	var found bool
	var doc struct {
		Name   string `bson:"name"`
		Expire *int32 `bson:"expireAfterSeconds"`
	}
	for idxs.Next(ctx) {
		if err := idxs.Decode(&doc); err == nil && doc.Name == "purge_at_ttl" && doc.Expire != nil {
			found = true
		}
	}
	if !found {
		t.Fatalf("purge_at TTL index missing")
	}
	_ = cur2
}

func TestMongoTripRepoManifestMoveLinkDelete(t *testing.T) {
	c := connectOrSkip(t)
	r := NewTripRepo(c)
	ctx := context.Background()
	_ = r.EnsureIndexes(ctx)
	a, b := "trip_"+randHex(16), "trip_"+randHex(16)
	_ = r.Insert(ctx, newTestTrip(a, "room_1"))
	del := newTestTrip(b, "room_1")
	d := time.Now().UTC()
	del.DeletedAt, del.DeletedBy = &d, "user_x"
	_ = r.Insert(ctx, del)

	stubs, err := r.Manifest(ctx, "room_1")
	if err != nil || len(stubs) != 2 {
		t.Fatalf("manifest: %v %v", stubs, err)
	}
	many, _ := r.GetMany(ctx, "room_1", []string{a, "trip_other"})
	if len(many) != 1 || many[0].TripID != a {
		t.Fatalf("GetMany: %+v", many)
	}

	if ok, _ := r.LinkPackingList(ctx, a, "room_1", nil, "list_1", time.Now()); !ok {
		t.Fatalf("first link should win")
	}
	if ok, _ := r.LinkPackingList(ctx, a, "room_1", nil, "list_2", time.Now()); ok {
		t.Fatalf("second link with expect=nil must lose")
	}
	linked, _ := r.Get(ctx, a)
	if linked.PackingListID == nil || *linked.PackingListID != "list_1" || linked.Version != 2 || linked.V != 2 {
		t.Fatalf("link state: %+v", linked)
	}

	if err := r.MoveRoom(ctx, "room_1", "room_9", time.Now()); err != nil {
		t.Fatal(err)
	}
	moved, _ := r.Get(ctx, a)
	if moved.RoomID != "room_9" || moved.Version != 3 {
		t.Fatalf("move: %+v", moved)
	}
	if err := r.DeleteByRoom(ctx, "room_9"); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Get(ctx, a); !errors.Is(err, derr.ErrNotFound) {
		t.Fatalf("DeleteByRoom left data: %v", err)
	}
}

func TestMongoTripDocumentSizes(t *testing.T) {
	c := connectOrSkip(t)
	r := NewTripRepo(c)
	ctx := context.Background()
	_ = r.EnsureIndexes(ctx)
	tr := newTestTrip("trip_"+randHex(16), "room_1")
	tr.Notes = strings.Repeat("n", 16384)
	for i := 0; i < trips.MaxTodos; i++ {
		tr.Todos = append(tr.Todos, models.TripTodo{TodoID: "ttd_" + randHex(16), Title: strings.Repeat("t", 200), Notes: strings.Repeat("x", 2048),
			Place: &models.Place{Name: strings.Repeat("p", 200), Address: strings.Repeat("a", 300), Source: "photon"}, FieldAt: map[string]int64{"title": 1}})
	}
	for i := 0; i < trips.MaxBookings; i++ {
		tr.Bookings = append(tr.Bookings, models.Booking{BookingID: "tbk_" + randHex(16), Kind: "flight", Title: "x", Notes: strings.Repeat("x", 2048), FieldAt: map[string]int64{}})
	}
	if err := r.Insert(ctx, tr); err != nil {
		t.Fatalf("a trip at every cap must be storable: %v", err)
	}
	raw, _ := json.Marshal(tr)
	t.Logf("worst-case trip JSON: %d KB", len(raw)/1024)
	if len(raw) > 2<<20 {
		t.Fatalf("worst-case trip exceeds 2MB (%d bytes); the spec expects ~0.6MB", len(raw))
	}
}

func TestMongoPlaceCacheRoundtripAndTTLIndex(t *testing.T) {
	c := connectOrSkip(t)
	r := NewPlaceCacheRepo(c)
	ctx := context.Background()
	if err := r.EnsureIndexes(ctx); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := r.Get(ctx, "k1"); ok {
		t.Fatalf("empty cache hit")
	}
	_ = r.Put(ctx, "k1", []models.Place{{Name: "Kyoto", Source: "photon"}}, time.Now().UTC())
	_ = r.Put(ctx, "k1", []models.Place{{Name: "Kyoto Station", Source: "photon"}}, time.Now().UTC()) // upsert
	got, ok, _ := r.Get(ctx, "k1")
	if !ok || len(got) != 1 || got[0].Name != "Kyoto Station" {
		t.Fatalf("cache: %v %v", got, ok)
	}
}
```

Add imports for `derr`, `errors`, `encoding/json`, `strings`, and `github.com/janvillarosa/gracie-app/backend/internal/trips` to the test file's import block.

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && go vet -tags=integration ./internal/store/mongo/`
Expected: FAIL (undefined: NewTripRepo).

- [ ] **Step 3: Implement `trip_repo.go`**

```go
package mongo

import (
	"context"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
	"go.mongodb.org/mongo-driver/bson"
	mgo "go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type TripRepo struct{ db *mgo.Database }

func NewTripRepo(c *Client) *TripRepo    { return &TripRepo{db: c.DB} }
func (r *TripRepo) col() *mgo.Collection { return r.db.Collection("trips") }

func (r *TripRepo) EnsureIndexes(ctx context.Context) error {
	_, err := r.col().Indexes().CreateMany(ctx, []mgo.IndexModel{
		{Keys: bson.D{{Key: "trip_id", Value: 1}}, Options: options.Index().SetUnique(true)},
		// Serves the sync manifest straight from the index.
		{Keys: bson.D{{Key: "room_id", Value: 1}, {Key: "deleted_at", Value: 1}, {Key: "trip_id", Value: 1}, {Key: "version", Value: 1}, {Key: "deleted_by", Value: 1}}},
		// purge_at is only set on soft delete; Mongo removes the trip 30 days later.
		{Keys: bson.D{{Key: "purge_at", Value: 1}}, Options: options.Index().SetName("purge_at_ttl").SetExpireAfterSeconds(0)},
	})
	return err
}

func (r *TripRepo) Get(ctx context.Context, tripID string) (*models.Trip, error) {
	var t models.Trip
	err := r.col().FindOne(ctx, bson.D{{Key: "trip_id", Value: tripID}}).Decode(&t)
	if err != nil {
		if err == mgo.ErrNoDocuments {
			return nil, derr.ErrNotFound
		}
		return nil, err
	}
	return &t, nil
}

func (r *TripRepo) Insert(ctx context.Context, t *models.Trip) error {
	if _, err := r.col().InsertOne(ctx, t); err != nil {
		if mgo.IsDuplicateKeyError(err) {
			return derr.ErrConflict
		}
		return err
	}
	return nil
}

func (r *TripRepo) ReplaceCAS(ctx context.Context, t *models.Trip, expect int64) (bool, error) {
	res, err := r.col().ReplaceOne(ctx, bson.D{{Key: "trip_id", Value: t.TripID}, {Key: "version", Value: expect}}, t)
	if err != nil {
		return false, err
	}
	return res.MatchedCount == 1, nil
}

func (r *TripRepo) Manifest(ctx context.Context, roomID string) ([]store.TripStub, error) {
	cur, err := r.col().Find(ctx, bson.D{{Key: "room_id", Value: roomID}},
		options.Find().SetProjection(bson.D{{Key: "trip_id", Value: 1}, {Key: "version", Value: 1}, {Key: "deleted_at", Value: 1}, {Key: "deleted_by", Value: 1}, {Key: "_id", Value: 0}}))
	if err != nil {
		return nil, err
	}
	var out []store.TripStub
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (r *TripRepo) GetMany(ctx context.Context, roomID string, ids []string) ([]models.Trip, error) {
	cur, err := r.col().Find(ctx, bson.D{{Key: "room_id", Value: roomID}, {Key: "trip_id", Value: bson.D{{Key: "$in", Value: ids}}}})
	if err != nil {
		return nil, err
	}
	var out []models.Trip
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// LinkPackingList uses an update pipeline so version and v can be incremented from the
// stored value in the same atomic write.
func (r *TripRepo) LinkPackingList(ctx context.Context, tripID, roomID string, expect *string, listID string, at time.Time) (bool, error) {
	var cur any // nil matches a missing or null packing_list_id
	if expect != nil {
		cur = *expect
	}
	filter := bson.D{{Key: "trip_id", Value: tripID}, {Key: "room_id", Value: roomID}, {Key: "deleted_at", Value: nil}, {Key: "packing_list_id", Value: cur}}
	update := mgo.Pipeline{{{Key: "$set", Value: bson.D{
		{Key: "packing_list_id", Value: listID},
		{Key: "version", Value: bson.D{{Key: "$add", Value: bson.A{"$version", 1}}}},
		{Key: "v", Value: bson.D{{Key: "$add", Value: bson.A{"$version", 1}}}},
		{Key: "updated_at", Value: at.UTC()},
	}}}}
	res, err := r.col().UpdateOne(ctx, filter, update)
	if err != nil {
		return false, err
	}
	return res.ModifiedCount == 1, nil
}

func (r *TripRepo) MoveRoom(ctx context.Context, from, to string, at time.Time) error {
	update := mgo.Pipeline{{{Key: "$set", Value: bson.D{
		{Key: "room_id", Value: to},
		{Key: "version", Value: bson.D{{Key: "$add", Value: bson.A{"$version", 1}}}},
		{Key: "v", Value: bson.D{{Key: "$add", Value: bson.A{"$version", 1}}}},
		{Key: "updated_at", Value: at.UTC()},
	}}}}
	_, err := r.col().UpdateMany(ctx, bson.D{{Key: "room_id", Value: from}}, update)
	return err
}

func (r *TripRepo) DeleteByRoom(ctx context.Context, roomID string) error {
	_, err := r.col().DeleteMany(ctx, bson.D{{Key: "room_id", Value: roomID}})
	return err
}

var _ store.TripRepository = (*TripRepo)(nil)
```

- [ ] **Step 4: Implement `place_cache_repo.go`**

```go
package mongo

import (
	"context"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
	"go.mongodb.org/mongo-driver/bson"
	mgo "go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type PlaceCacheRepo struct{ db *mgo.Database }

func NewPlaceCacheRepo(c *Client) *PlaceCacheRepo { return &PlaceCacheRepo{db: c.DB} }
func (r *PlaceCacheRepo) col() *mgo.Collection    { return r.db.Collection("place_cache") }

const placeCacheTTLSeconds = 30 * 24 * 3600

type placeCacheDoc struct {
	Key       string         `bson:"key"`
	Places    []models.Place `bson:"places"`
	CreatedAt time.Time      `bson:"created_at"`
}

func (r *PlaceCacheRepo) EnsureIndexes(ctx context.Context) error {
	_, err := r.col().Indexes().CreateMany(ctx, []mgo.IndexModel{
		{Keys: bson.D{{Key: "key", Value: 1}}, Options: options.Index().SetUnique(true)},
		{Keys: bson.D{{Key: "created_at", Value: 1}}, Options: options.Index().SetExpireAfterSeconds(placeCacheTTLSeconds)},
	})
	return err
}

func (r *PlaceCacheRepo) Get(ctx context.Context, key string) ([]models.Place, bool, error) {
	var d placeCacheDoc
	err := r.col().FindOne(ctx, bson.D{{Key: "key", Value: key}}).Decode(&d)
	if err == mgo.ErrNoDocuments {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return d.Places, true, nil
}

func (r *PlaceCacheRepo) Put(ctx context.Context, key string, places []models.Place, at time.Time) error {
	_, err := r.col().ReplaceOne(ctx, bson.D{{Key: "key", Value: key}},
		placeCacheDoc{Key: key, Places: places, CreatedAt: at.UTC()}, options.Replace().SetUpsert(true))
	return err
}

var _ store.PlaceCacheRepository = (*PlaceCacheRepo)(nil)
```

- [ ] **Step 5: Run against Mongo, document, commit**

Start Mongo if needed (`docker compose up -d mongo`, see `.env.example`), then run: `cd backend && go vet -tags=integration ./... && go test -tags=integration ./internal/store/mongo/ -count=1 -v -run 'Trip|PlaceCache'`
Expected: PASS (or SKIP with "mongo unavailable" — a skip does **not** satisfy this task; get Mongo running and rerun).

Add to `backend/internal/store/CLAUDE.md` a paragraph: collections `trips` (indexes: unique `trip_id`; `(room_id, deleted_at, trip_id, version, deleted_by)` for the sync manifest; TTL `purge_at_ttl` expireAfterSeconds 0) and `place_cache` (unique `key`; 30-day TTL on `created_at`); writes to `trips` go only through `ReplaceCAS`/`Insert`/`LinkPackingList`.

```bash
git add backend
git commit -m "feat(trips): Mongo trip and place-cache repositories

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Rate limiter

**Files:**
- Create: `backend/internal/ratelimit/limiter.go`
- Test: `backend/internal/ratelimit/limiter_test.go`

**Interfaces:**
- Produces: `ratelimit.New(ratePerSec float64, burst int) *Limiter` and `(*Limiter).Allow(key string) bool`; unexported `now func() time.Time` for tests.

- [ ] **Step 1: Write the failing test**

`backend/internal/ratelimit/limiter_test.go`:

```go
package ratelimit

import (
	"testing"
	"time"
)

func TestBurstThenRefill(t *testing.T) {
	clock := time.Unix(1000, 0)
	l := New(2, 3) // 2 tokens/s, burst 3
	l.now = func() time.Time { return clock }
	for i := 0; i < 3; i++ {
		if !l.Allow("u") {
			t.Fatalf("burst call %d denied", i)
		}
	}
	if l.Allow("u") {
		t.Fatal("4th immediate call should be denied")
	}
	if !l.Allow("other") {
		t.Fatal("keys are independent")
	}
	clock = clock.Add(600 * time.Millisecond) // +1.2 tokens
	if !l.Allow("u") {
		t.Fatal("should have refilled one token")
	}
	if l.Allow("u") {
		t.Fatal("only one token had refilled")
	}
}

func TestIdleBucketsArePruned(t *testing.T) {
	clock := time.Unix(1000, 0)
	l := New(1, 1)
	l.now = func() time.Time { return clock }
	for i := 0; i < maxBuckets+10; i++ {
		l.Allow(string(rune(i + 1)))
	}
	clock = clock.Add(time.Hour)
	l.Allow("fresh")
	if len(l.buckets) > 5 {
		t.Fatalf("idle buckets not pruned: %d", len(l.buckets))
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && go test ./internal/ratelimit/ -count=1`
Expected: FAIL (build).

- [ ] **Step 3: Implement**

```go
// Package ratelimit is a small in-process token-bucket limiter keyed by string.
package ratelimit

import (
	"sync"
	"time"
)

const (
	maxBuckets = 10000
	idleAfter  = 10 * time.Minute
)

type bucket struct {
	tokens float64
	last   time.Time
}

type Limiter struct {
	mu      sync.Mutex
	rate    float64
	burst   float64
	buckets map[string]*bucket
	now     func() time.Time
}

func New(ratePerSec float64, burst int) *Limiter {
	return &Limiter{rate: ratePerSec, burst: float64(burst), buckets: map[string]*bucket{}, now: time.Now}
}

// Allow consumes one token for key and reports whether the call may proceed.
func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if len(l.buckets) > maxBuckets {
		for k, b := range l.buckets {
			if now.Sub(b.last) > idleAfter {
				delete(l.buckets, k)
			}
		}
	}
	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	b.tokens += now.Sub(b.last).Seconds() * l.rate
	if b.tokens > l.burst {
		b.tokens = l.burst
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}
```

- [ ] **Step 4: Run, commit**

Run: `cd backend && gofmt -l internal/ratelimit; go test ./internal/ratelimit/ -count=1`
Expected: PASS. (`TestIdleBucketsArePruned` triggers pruning because the map exceeds `maxBuckets` when `"fresh"` arrives.)

```bash
git add backend/internal/ratelimit
git commit -m "feat(ratelimit): token-bucket limiter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Trip HTTP handlers, routes, compression

**Files:**
- Create: `backend/internal/http/handlers/trip.go`
- Modify: `backend/internal/http/router/router.go` (add `Trip` to `Handlers`, routes, `middleware.Compress(5, "application/json")`)
- Test: `backend/internal/http/handlers/trip_handlers_test.go`

**Interfaces:**
- Consumes: `services.TripService` (`ApplyOps`, `Sync`, `EnsurePackingList`), `ratelimit.Limiter`, `api.UserFrom`, `api.WriteJSON`, `api.DecodeJSON`.
- Produces: `handlers.NewTripHandler(svc *services.TripService, rl *ratelimit.Limiter) *TripHandler`; methods `Sync`, `Ops`, `PackingList`; `router.Handlers.Trip *handlers.TripHandler` (routes registered only when non-nil); routes `POST /rooms/{room_id}/trips/sync`, `POST /rooms/{room_id}/trips/ops`, `POST /rooms/{room_id}/trips/{trip_id}/packing-list`.

- [ ] **Step 1: Write the failing tests**

`backend/internal/http/handlers/trip_handlers_test.go`:

```go
package handlers_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	handlers "github.com/janvillarosa/gracie-app/backend/internal/http/handlers"
	"github.com/janvillarosa/gracie-app/backend/internal/http/router"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/ratelimit"
	"github.com/janvillarosa/gracie-app/backend/internal/services"
	"github.com/janvillarosa/gracie-app/backend/internal/services/categorization"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

type tripFixture struct {
	h      http.Handler
	apiKey string
	roomID string
}

func newTripFixture(t *testing.T, tripRepo store.TripRepository, rl *ratelimit.Limiter) tripFixture {
	t.Helper()
	m := memstore.Compose()
	if tripRepo == nil {
		tripRepo = m.Trips
	}
	userSvc := services.NewUserService(m.Users, m.Rooms, m.Tx)
	roomSvc := services.NewRoomService(m.Users, m.Rooms, m.Tx)
	listSvc := services.NewListService(m.Users, m.Rooms, m.Lists, m.Items, categorization.NewKeywordCategorizer(categorization.GroceryAnchors))
	tripSvc := services.NewTripService(m.Rooms, tripRepo, listSvc, m.Lists)
	authSvc, err := services.NewAuthService(m.Users, "/tmp/gracie-test-enc.key", 720)
	if err != nil {
		t.Fatal(err)
	}
	if rl == nil {
		rl = ratelimit.New(1000, 1000)
	}
	h := router.NewRouter(m.Users, router.Handlers{
		Auth: handlers.NewAuthHandler(authSvc), User: handlers.NewUserHandler(userSvc, []byte("salt")),
		Room: handlers.NewRoomHandler(roomSvc, m.Users, []byte("salt")), List: handlers.NewListHandler(listSvc),
		Trip: handlers.NewTripHandler(tripSvc, rl),
	})
	cu, err := userSvc.CreateUserWithSoloRoom(context.Background(), "A")
	if err != nil {
		t.Fatal(err)
	}
	return tripFixture{h: h, apiKey: cu.APIKey, roomID: *cu.User.RoomID}
}

func (f tripFixture) post(path string, body any, headers map[string]string) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	switch b := body.(type) {
	case string:
		buf.WriteString(b)
	default:
		_ = json.NewEncoder(&buf).Encode(b)
	}
	req := httptest.NewRequest(http.MethodPost, path, &buf)
	req.Header.Set("Authorization", "Bearer "+f.apiKey)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	f.h.ServeHTTP(rec, req)
	return rec
}

var hTripID = "trip_" + strings.Repeat("c", 32)

func hOp(seq int, typ, entity string, patch map[string]any) map[string]any {
	m := map[string]any{"v": 1, "op_id": "op-" + string(rune('a'+seq)), "client_id": "dev-h", "seq": seq,
		"at": time.Now().UnixMilli() - 500, "type": typ, "trip_id": hTripID}
	if entity != "" {
		m["entity_id"] = entity
	}
	if patch != nil {
		m["patch"] = patch
	}
	return m
}

func TestTripOpsAndSyncOverHTTP(t *testing.T) {
	f := newTripFixture(t, nil, nil)
	body := map[string]any{"ops": []any{
		hOp(1, "trip.create", "", map[string]any{"title": "Japan"}),
		hOp(2, "todo.create", "ttd_"+strings.Repeat("1", 32), map[string]any{"title": "Ramen"}),
		map[string]any{"op_id": "op-bad", "v": 1, "nonsense": true},
	}}
	rec := f.post("/rooms/"+f.roomID+"/trips/ops", body, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("ops: %d %s", rec.Code, rec.Body)
	}
	var resp struct {
		Results []models.OpResult  `json:"results"`
		Trips   []models.TripDelta `json:"trips"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Results) != 3 || resp.Results[0].Status != "applied" || resp.Results[2].Code != "unsupported" || len(resp.Trips) != 1 {
		t.Fatalf("per-op results must be independent: %+v", resp)
	}

	rec = f.post("/rooms/"+f.roomID+"/trips/sync", map[string]any{"known": map[string]int64{}}, nil)
	var sync struct {
		Trips []models.TripDelta `json:"trips"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &sync)
	if rec.Code != http.StatusOK || len(sync.Trips) != 1 || !sync.Trips[0].Full {
		t.Fatalf("sync: %d %s", rec.Code, rec.Body)
	}
}

func TestTripEndpointsRequireAuthAndMembership(t *testing.T) {
	f := newTripFixture(t, nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/rooms/"+f.roomID+"/trips/sync", strings.NewReader(`{"known":{}}`))
	rec := httptest.NewRecorder()
	f.h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no auth: %d", rec.Code)
	}
	if rec := f.post("/rooms/room_someone_else/trips/sync", map[string]any{"known": map[string]int64{}}, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("wrong room: %d", rec.Code)
	}
}

func TestTripBodyLimits(t *testing.T) {
	f := newTripFixture(t, nil, nil)
	big := `{"known":{},"pad":"` + strings.Repeat("x", 70*1024) + `"}`
	if rec := f.post("/rooms/"+f.roomID+"/trips/sync", big, nil); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("sync body over 64KB: want 413, got %d", rec.Code)
	}
	huge := `{"ops":[],"pad":"` + strings.Repeat("x", (1<<20)+10) + `"}`
	if rec := f.post("/rooms/"+f.roomID+"/trips/ops", huge, nil); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("ops body over 1MB: want 413, got %d", rec.Code)
	}
	if rec := f.post("/rooms/"+f.roomID+"/trips/ops", `{"ops":[]}`, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("empty batch: want 400, got %d", rec.Code)
	}
	if rec := f.post("/rooms/"+f.roomID+"/trips/ops", `not json`, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("malformed: want 400, got %d", rec.Code)
	}
}

func TestTripResponsesAreGzipped(t *testing.T) {
	f := newTripFixture(t, nil, nil)
	rec := f.post("/rooms/"+f.roomID+"/trips/sync", map[string]any{"known": map[string]int64{}}, map[string]string{"Accept-Encoding": "gzip"})
	if rec.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("expected gzip, headers=%v", rec.Header())
	}
	zr, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(zr)
	if !strings.Contains(string(b), `"trips"`) {
		t.Fatalf("body: %s", b)
	}
}

type failingTrips struct{ store.TripRepository }

func (failingTrips) Manifest(context.Context, string) ([]store.TripStub, error) {
	return nil, errors.New("mongo exploded")
}

func TestUnknownErrorsMapTo500NotBadRequest(t *testing.T) {
	m := memstore.Compose()
	f := newTripFixture(t, failingTrips{m.Trips}, nil)
	rec := f.post("/rooms/"+f.roomID+"/trips/sync", map[string]any{"known": map[string]int64{}}, nil)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d %s", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), "mongo exploded") {
		t.Fatalf("internal error text must not leak: %s", rec.Body)
	}
}

func TestTripRateLimit(t *testing.T) {
	f := newTripFixture(t, nil, ratelimit.New(0.0001, 2))
	for i := 0; i < 2; i++ {
		if rec := f.post("/rooms/"+f.roomID+"/trips/sync", map[string]any{"known": map[string]int64{}}, nil); rec.Code != http.StatusOK {
			t.Fatalf("call %d: %d", i, rec.Code)
		}
	}
	if rec := f.post("/rooms/"+f.roomID+"/trips/sync", map[string]any{"known": map[string]int64{}}, nil); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("want 429, got %d", rec.Code)
	}
}

func TestPackingListEndpoint(t *testing.T) {
	f := newTripFixture(t, nil, nil)
	f.post("/rooms/"+f.roomID+"/trips/ops", map[string]any{"ops": []any{hOp(1, "trip.create", "", map[string]any{"title": "Japan"})}}, nil)
	rec := f.post("/rooms/"+f.roomID+"/trips/"+hTripID+"/packing-list", `{}`, nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Packing") {
		t.Fatalf("packing: %d %s", rec.Code, rec.Body)
	}
	rec = f.post("/rooms/"+f.roomID+"/trips/trip_"+strings.Repeat("0", 32)+"/packing-list", `{}`, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown trip: %d", rec.Code)
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && go test ./internal/http/handlers/ -run 'Trip|Packing|Unknown' -count=1`
Expected: FAIL (undefined: Trip / NewTripHandler).

- [ ] **Step 3: Implement `trip.go`**

```go
package handlers

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	api "github.com/janvillarosa/gracie-app/backend/internal/http"
	"github.com/janvillarosa/gracie-app/backend/internal/ratelimit"
	"github.com/janvillarosa/gracie-app/backend/internal/services"
)

const (
	maxSyncBody = 64 << 10
	maxOpsBody  = 1 << 20
)

type TripHandler struct {
	Trips *services.TripService
	rl    *ratelimit.Limiter
}

func NewTripHandler(trips *services.TripService, rl *ratelimit.Limiter) *TripHandler {
	return &TripHandler{Trips: trips, rl: rl}
}

// tripStatus maps service errors to HTTP statuses. Unlike statusFromErr (lists), unknown
// errors are server errors (500), and their text is never sent to the client.
func tripStatus(err error) (int, string) {
	switch {
	case errors.Is(err, derr.ErrUnauthorized):
		return http.StatusUnauthorized, "unauthorized"
	case errors.Is(err, derr.ErrForbidden):
		return http.StatusForbidden, "forbidden"
	case errors.Is(err, derr.ErrNotFound):
		return http.StatusNotFound, "not found"
	case errors.Is(err, derr.ErrConflict):
		return http.StatusConflict, "conflict"
	case errors.Is(err, derr.ErrBadRequest):
		return http.StatusBadRequest, "bad request"
	case errors.Is(err, derr.ErrRateLimited):
		return http.StatusTooManyRequests, "rate limited"
	}
	log.Printf("trips: internal error: %v", err)
	return http.StatusInternalServerError, "internal error"
}

func writeTripErr(w http.ResponseWriter, err error) {
	code, msg := tripStatus(err)
	api.WriteJSON(w, code, map[string]string{"error": msg})
}

// decodeLimited decodes a strict JSON body of at most max bytes. It writes the error
// response itself and returns false on failure.
func decodeLimited(w http.ResponseWriter, r *http.Request, max int64, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, max)
	if err := api.DecodeJSON(r, dst); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			api.WriteJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "request too large"})
		} else {
			api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		}
		return false
	}
	return true
}

func (h *TripHandler) Sync(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if !h.rl.Allow("trips:" + u.UserID) {
		writeTripErr(w, derr.ErrRateLimited)
		return
	}
	var req struct {
		Known map[string]int64 `json:"known"`
	}
	if !decodeLimited(w, r, maxSyncBody, &req) {
		return
	}
	resp, err := h.Trips.Sync(r.Context(), u, chi.URLParam(r, "room_id"), req.Known)
	if err != nil {
		writeTripErr(w, err)
		return
	}
	api.WriteJSON(w, http.StatusOK, resp)
}

func (h *TripHandler) Ops(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if !h.rl.Allow("trips:" + u.UserID) {
		writeTripErr(w, derr.ErrRateLimited)
		return
	}
	var req struct {
		Ops []json.RawMessage `json:"ops"` // strict envelope; each op is decoded on its own
	}
	if !decodeLimited(w, r, maxOpsBody, &req) {
		return
	}
	resp, err := h.Trips.ApplyOps(r.Context(), u, chi.URLParam(r, "room_id"), req.Ops)
	if err != nil {
		writeTripErr(w, err)
		return
	}
	api.WriteJSON(w, http.StatusOK, resp)
}

func (h *TripHandler) PackingList(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	l, err := h.Trips.EnsurePackingList(r.Context(), u, chi.URLParam(r, "room_id"), chi.URLParam(r, "trip_id"))
	if err != nil {
		writeTripErr(w, err)
		return
	}
	api.WriteJSON(w, http.StatusOK, l)
}
```

- [ ] **Step 4: Router changes**

In `router.go`: add `Trip *handlers.TripHandler` to `Handlers`; add `r.Use(middleware.Compress(5, "application/json"))` right after `r.Use(middleware.Recoverer)`; and, inside the authenticated group after the Lists routes:

```go
		if h.Trip != nil {
			ar.Post("/rooms/{room_id}/trips/sync", h.Trip.Sync)
			ar.Post("/rooms/{room_id}/trips/ops", h.Trip.Ops)
			ar.Post("/rooms/{room_id}/trips/{trip_id}/packing-list", h.Trip.PackingList)
		}
```

- [ ] **Step 5: Run, commit**

Run: `cd backend && gofmt -w internal && go vet ./... && go test ./... -count=1` then `make check` from the repo root.
Expected: PASS.

```bash
git add backend
git commit -m "feat(trips): HTTP handlers, routes, gzip, body limits and rate limiting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Places proxy

**Files:**
- Create: `backend/internal/services/places/geocoder.go` (interface + Photon client), `tz.go`, `service.go`
- Create: `backend/internal/http/handlers/places.go`
- Modify: `backend/internal/http/router/router.go` (add `Places *handlers.PlacesHandler`; routes `GET /places/search`, `GET /places/reverse`, authenticated, registered when non-nil)
- Test: `backend/internal/services/places/places_test.go`, `backend/internal/http/handlers/places_handlers_test.go`
- Run: `cd backend && go get github.com/ringsaturn/tzf@latest && go mod tidy`

**Interfaces:**
- Produces:

```go
package places
type Geocoder interface {
	Search(ctx context.Context, q string, lat, lng *float64, lang string, limit int) ([]models.Place, error)
	Reverse(ctx context.Context, lat, lng float64, lang string) (*models.Place, error)
}
type TZResolver interface{ TZ(lat, lng float64) string }
func NewPhoton(baseURL, userAgent string, timeout time.Duration, client *http.Client) *Photon
func NewTZF() (TZResolver, error)
type Result struct { Results []models.Place `json:"results"`; Degraded bool `json:"degraded,omitempty"` }
func NewService(g Geocoder, tz TZResolver, cache store.PlaceCacheRepository, server *ratelimit.Limiter) *Service
func (s *Service) Search(ctx context.Context, q string, lat, lng *float64, lang string, limit int) (Result, error)
func (s *Service) Reverse(ctx context.Context, lat, lng float64, lang string) (Result, error)
handlers.NewPlacesHandler(svc *places.Service, perUser *ratelimit.Limiter) *PlacesHandler  // Search, Reverse
```
- Search validation errors return `derr.ErrBadRequest`; a server-wide limiter denial returns `derr.ErrRateLimited`; an upstream failure/timeout returns `Result{Results: [], Degraded: true}` with a nil error. A nil `Geocoder` (no `PHOTON_BASE_URL`) behaves like an upstream failure.

- [ ] **Step 1: Write the failing service tests**

`backend/internal/services/places/places_test.go`:

```go
package places

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/ratelimit"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

const photonBody = `{"features":[{"geometry":{"coordinates":[135.7585,34.9858]},"properties":{"name":"Kyoto Station","street":"Karasuma","housenumber":"1","city":"Kyoto","country":"Japan","osm_id":123,"osm_type":"W"}}]}`

func photonServer(t *testing.T, hits *int32, status int, body string, delay time.Duration) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(hits, 1)
		if r.Header.Get("User-Agent") == "" {
			t.Errorf("upstream request must carry a User-Agent")
		}
		time.Sleep(delay)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv
}

type fixedTZ struct{}

func (fixedTZ) TZ(lat, lng float64) string { return "Asia/Tokyo" }

func newSvc(t *testing.T, srv *httptest.Server, timeout time.Duration, server *ratelimit.Limiter) *Service {
	var g Geocoder
	if srv != nil {
		g = NewPhoton(srv.URL, "bauhouse-test/1.0", timeout, srv.Client())
	}
	if server == nil {
		server = ratelimit.New(1000, 1000)
	}
	return NewService(g, fixedTZ{}, memstore.Compose().Places, server)
}

func TestSearchParsesPhotonAndFillsTZ(t *testing.T) {
	var hits int32
	s := newSvc(t, photonServer(t, &hits, 200, photonBody, 0), time.Second, nil)
	res, err := s.Search(context.Background(), "Kyoto Station", nil, nil, "en", 5)
	if err != nil || res.Degraded || len(res.Results) != 1 {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	p := res.Results[0]
	if p.Name != "Kyoto Station" || p.Lat != 34.9858 || p.Lng != 135.7585 || p.TZ != "Asia/Tokyo" || p.Source != "photon" || p.OSMRef != "W123" {
		t.Fatalf("place: %+v", p)
	}
	if !strings.Contains(p.Address, "Kyoto") {
		t.Fatalf("address: %q", p.Address)
	}
}

func TestSearchIsCachedAndKeyIsNormalised(t *testing.T) {
	var hits int32
	s := newSvc(t, photonServer(t, &hits, 200, photonBody, 0), time.Second, nil)
	lat, lng := 35.04, 135.71
	lat2, lng2 := 35.049, 135.749 // same 0.1° cell
	_, _ = s.Search(context.Background(), "  Kyoto Station ", &lat, &lng, "en", 5)
	res, _ := s.Search(context.Background(), "kyoto station", &lat2, &lng2, "en", 5)
	if atomic.LoadInt32(&hits) != 1 || len(res.Results) != 1 {
		t.Fatalf("second call should hit the cache; upstream hits=%d", hits)
	}
}

func TestSearchValidation(t *testing.T) {
	var hits int32
	s := newSvc(t, photonServer(t, &hits, 200, photonBody, 0), time.Second, nil)
	for _, q := range []string{"", "ab", "  a "} {
		if _, err := s.Search(context.Background(), q, nil, nil, "en", 5); !errors.Is(err, derr.ErrBadRequest) {
			t.Fatalf("q=%q should be a bad request, got %v", q, err)
		}
	}
	bad := 123.0
	if _, err := s.Search(context.Background(), "kyoto", &bad, &bad, "en", 5); !errors.Is(err, derr.ErrBadRequest) {
		t.Fatalf("out-of-range coordinates: %v", err)
	}
	if atomic.LoadInt32(&hits) != 0 {
		t.Fatalf("invalid requests must not reach the upstream")
	}
}

func TestUpstreamFailureTimeoutAndNoGeocoderDegrade(t *testing.T) {
	var hits int32
	cases := map[string]*Service{
		"5xx":     newSvc(t, photonServer(t, &hits, 503, "down", 0), time.Second, nil),
		"timeout": newSvc(t, photonServer(t, &hits, 200, photonBody, 300*time.Millisecond), 50*time.Millisecond, nil),
		"garbage": newSvc(t, photonServer(t, &hits, 200, "<html>", 0), time.Second, nil),
		"none":    newSvc(t, nil, time.Second, nil),
	}
	for name, s := range cases {
		res, err := s.Search(context.Background(), "kyoto station", nil, nil, "en", 5)
		if err != nil || !res.Degraded || len(res.Results) != 0 || res.Results == nil {
			t.Fatalf("%s: want degraded empty list, got %+v err=%v", name, res, err)
		}
	}
}

func TestDegradedResultsAreNotCached(t *testing.T) {
	var hits int32
	s := newSvc(t, photonServer(t, &hits, 503, "down", 0), time.Second, nil)
	_, _ = s.Search(context.Background(), "kyoto station", nil, nil, "en", 5)
	_, _ = s.Search(context.Background(), "kyoto station", nil, nil, "en", 5)
	if atomic.LoadInt32(&hits) != 2 {
		t.Fatalf("failures must not poison the cache; hits=%d", hits)
	}
}

func TestServerWideLimiterProtectsUpstream(t *testing.T) {
	var hits int32
	s := newSvc(t, photonServer(t, &hits, 200, photonBody, 0), time.Second, ratelimit.New(0.0001, 1))
	if _, err := s.Search(context.Background(), "kyoto station", nil, nil, "en", 5); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Search(context.Background(), "osaka castle", nil, nil, "en", 5); !errors.Is(err, derr.ErrRateLimited) {
		t.Fatalf("want ErrRateLimited, got %v", err)
	}
}

func TestReverse(t *testing.T) {
	var hits int32
	s := newSvc(t, photonServer(t, &hits, 200, photonBody, 0), time.Second, nil)
	res, err := s.Reverse(context.Background(), 34.9858, 135.7585, "en")
	if err != nil || len(res.Results) != 1 || res.Results[0].Source != "pin" {
		t.Fatalf("reverse: %+v %v", res, err)
	}
	if _, err := s.Reverse(context.Background(), 200, 0, "en"); !errors.Is(err, derr.ErrBadRequest) {
		t.Fatalf("bad coords: %v", err)
	}
	_ = models.Place{}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && go test ./internal/services/places/ -count=1`
Expected: FAIL (build).

- [ ] **Step 3: Implement `geocoder.go`**

```go
// Package places proxies place search to a Photon-compatible geocoder with caching,
// rate limiting and graceful degradation.
package places

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

const maxUpstreamBytes = 256 << 10

type Geocoder interface {
	Search(ctx context.Context, q string, lat, lng *float64, lang string, limit int) ([]models.Place, error)
	Reverse(ctx context.Context, lat, lng float64, lang string) (*models.Place, error)
}

// Photon talks to a Photon-compatible API at a fixed, operator-configured base URL.
type Photon struct {
	base      string
	userAgent string
	timeout   time.Duration
	client    *http.Client
}

func NewPhoton(baseURL, userAgent string, timeout time.Duration, client *http.Client) *Photon {
	if client == nil {
		client = &http.Client{}
	}
	return &Photon{base: strings.TrimRight(baseURL, "/"), userAgent: userAgent, timeout: timeout, client: client}
}

type photonResp struct {
	Features []struct {
		Geometry struct {
			Coordinates []float64 `json:"coordinates"` // [lng, lat]
		} `json:"geometry"`
		Properties struct {
			Name        string `json:"name"`
			Street      string `json:"street"`
			HouseNumber string `json:"housenumber"`
			City        string `json:"city"`
			State       string `json:"state"`
			Country     string `json:"country"`
			OSMID       int64  `json:"osm_id"`
			OSMType     string `json:"osm_type"`
		} `json:"properties"`
	} `json:"features"`
}

func (p *Photon) get(ctx context.Context, path string, q url.Values) (*photonResp, error) {
	ctx, cancel := context.WithTimeout(ctx, p.timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.base+path+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", p.userAgent)
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("photon: status %d", resp.StatusCode)
	}
	var out photonResp
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxUpstreamBytes)).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

func toPlaces(r *photonResp, source string) []models.Place {
	out := make([]models.Place, 0, len(r.Features))
	for _, f := range r.Features {
		if len(f.Geometry.Coordinates) != 2 || f.Properties.Name == "" {
			continue
		}
		pr := f.Properties
		var parts []string
		for _, s := range []string{strings.TrimSpace(pr.Street + " " + pr.HouseNumber), pr.City, pr.State, pr.Country} {
			if s != "" {
				parts = append(parts, s)
			}
		}
		pl := models.Place{Name: pr.Name, Address: strings.Join(parts, ", "), Lng: f.Geometry.Coordinates[0], Lat: f.Geometry.Coordinates[1], Source: source}
		if pr.OSMType != "" && pr.OSMID != 0 {
			pl.OSMRef = fmt.Sprintf("%s%d", pr.OSMType, pr.OSMID)
		}
		out = append(out, pl)
	}
	return out
}

func (p *Photon) Search(ctx context.Context, q string, lat, lng *float64, lang string, limit int) ([]models.Place, error) {
	v := url.Values{}
	v.Set("q", q)
	v.Set("lang", lang)
	v.Set("limit", fmt.Sprint(limit))
	if lat != nil && lng != nil {
		v.Set("lat", fmt.Sprintf("%.1f", *lat)) // rounded bias, never exact coordinates
		v.Set("lon", fmt.Sprintf("%.1f", *lng))
	}
	r, err := p.get(ctx, "/api", v)
	if err != nil {
		return nil, err
	}
	return toPlaces(r, "photon"), nil
}

func (p *Photon) Reverse(ctx context.Context, lat, lng float64, lang string) (*models.Place, error) {
	v := url.Values{}
	v.Set("lat", fmt.Sprintf("%.5f", lat))
	v.Set("lon", fmt.Sprintf("%.5f", lng))
	v.Set("lang", lang)
	r, err := p.get(ctx, "/reverse", v)
	if err != nil {
		return nil, err
	}
	ps := toPlaces(r, "pin")
	if len(ps) == 0 {
		return nil, nil
	}
	return &ps[0], nil
}
```

- [ ] **Step 4: Implement `tz.go`**

```go
package places

import "github.com/ringsaturn/tzf"

// TZResolver maps coordinates to an IANA zone using an embedded offline dataset.
type TZResolver interface{ TZ(lat, lng float64) string }

type tzfResolver struct{ f tzf.F }

func (r tzfResolver) TZ(lat, lng float64) string { return r.f.GetTimezoneName(lng, lat) }

// NewTZF loads the embedded timezone finder. Measure its RAM and binary-size cost in the build log.
func NewTZF() (TZResolver, error) {
	f, err := tzf.NewDefaultFinder()
	if err != nil {
		return nil, err
	}
	return tzfResolver{f: f}, nil
}
```

If `go build` reports a different tzf API (the module's constructor/method names have changed between majors), run `go doc github.com/ringsaturn/tzf` and adapt only this file: the contract is `TZ(lat, lng float64) string` returning `""` when unknown.

- [ ] **Step 5: Implement `service.go`**

```go
package places

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/ratelimit"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
)

var reLang = regexp.MustCompile(`^[a-z]{2}(-[A-Za-z]{2})?$`)

// Result is the places API payload.
type Result struct {
	Results  []models.Place `json:"results"`
	Degraded bool           `json:"degraded,omitempty"`
}

type Service struct {
	geo    Geocoder // may be nil: places are then always degraded
	tz     TZResolver
	cache  store.PlaceCacheRepository
	server *ratelimit.Limiter
}

func NewService(g Geocoder, tz TZResolver, cache store.PlaceCacheRepository, server *ratelimit.Limiter) *Service {
	return &Service{geo: g, tz: tz, cache: cache, server: server}
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }

func validCoords(lat, lng float64) bool {
	return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !math.IsNaN(lat) && !math.IsNaN(lng)
}

func normLang(l string) string {
	if reLang.MatchString(l) {
		return l
	}
	return "en"
}

func cacheKey(q string, lat, lng *float64, lang string) string {
	loc := "-"
	if lat != nil && lng != nil {
		loc = fmt.Sprintf("%.1f,%.1f", round1(*lat), round1(*lng))
	}
	sum := sha256.Sum256([]byte(q + "|" + loc + "|" + lang))
	return hex.EncodeToString(sum[:])
}

func (s *Service) fillTZ(ps []models.Place) {
	for i := range ps {
		if ps[i].TZ == "" && s.tz != nil {
			ps[i].TZ = s.tz.TZ(ps[i].Lat, ps[i].Lng)
		}
	}
}

func degraded() Result { return Result{Results: []models.Place{}, Degraded: true} }

func (s *Service) Search(ctx context.Context, q string, lat, lng *float64, lang string, limit int) (Result, error) {
	q = strings.ToLower(strings.TrimSpace(q))
	if utf8.RuneCountInString(q) < 3 || utf8.RuneCountInString(q) > 100 {
		return Result{}, derr.ErrBadRequest
	}
	if (lat == nil) != (lng == nil) || (lat != nil && !validCoords(*lat, *lng)) {
		return Result{}, derr.ErrBadRequest
	}
	if limit < 1 || limit > 10 {
		limit = 5
	}
	lang = normLang(lang)
	key := cacheKey(q, lat, lng, lang)
	if cached, ok, err := s.cache.Get(ctx, key); err == nil && ok {
		return Result{Results: cached}, nil
	}
	if s.geo == nil {
		return degraded(), nil
	}
	if !s.server.Allow("places") {
		return Result{}, derr.ErrRateLimited
	}
	ps, err := s.geo.Search(ctx, q, lat, lng, lang, limit)
	if err != nil {
		return degraded(), nil // never a 5xx: the client falls back to manual place / pin
	}
	s.fillTZ(ps)
	if len(ps) > 0 {
		_ = s.cache.Put(ctx, key, ps, time.Now().UTC())
	}
	return Result{Results: ps}, nil
}

func (s *Service) Reverse(ctx context.Context, lat, lng float64, lang string) (Result, error) {
	if !validCoords(lat, lng) {
		return Result{}, derr.ErrBadRequest
	}
	lang = normLang(lang)
	if s.geo == nil {
		return degraded(), nil
	}
	if !s.server.Allow("places") {
		return Result{}, derr.ErrRateLimited
	}
	p, err := s.geo.Reverse(ctx, lat, lng, lang)
	if err != nil {
		return degraded(), nil
	}
	if p == nil {
		return Result{Results: []models.Place{}}, nil
	}
	ps := []models.Place{*p}
	s.fillTZ(ps)
	return Result{Results: ps}, nil
}
```

Reverse lookups are deliberately **not** cached (exact pin coordinates must not be stored).

- [ ] **Step 6: Handler and tests**

`backend/internal/http/handlers/places.go`:

```go
package handlers

import (
	"net/http"
	"strconv"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	api "github.com/janvillarosa/gracie-app/backend/internal/http"
	"github.com/janvillarosa/gracie-app/backend/internal/ratelimit"
	"github.com/janvillarosa/gracie-app/backend/internal/services/places"
)

type PlacesHandler struct {
	svc     *places.Service
	perUser *ratelimit.Limiter
}

func NewPlacesHandler(svc *places.Service, perUser *ratelimit.Limiter) *PlacesHandler {
	return &PlacesHandler{svc: svc, perUser: perUser}
}

func floatParam(r *http.Request, name string) (*float64, bool) {
	s := r.URL.Query().Get(name)
	if s == "" {
		return nil, true
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil, false
	}
	return &v, true
}

func (h *PlacesHandler) Search(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if !h.perUser.Allow("places:" + u.UserID) {
		writeTripErr(w, derr.ErrRateLimited)
		return
	}
	lat, ok1 := floatParam(r, "lat")
	lng, ok2 := floatParam(r, "lng")
	if !ok1 || !ok2 {
		writeTripErr(w, derr.ErrBadRequest)
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	res, err := h.svc.Search(r.Context(), r.URL.Query().Get("q"), lat, lng, r.URL.Query().Get("lang"), limit)
	if err != nil {
		writeTripErr(w, err)
		return
	}
	api.WriteJSON(w, http.StatusOK, res)
}

func (h *PlacesHandler) Reverse(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if !h.perUser.Allow("places:" + u.UserID) {
		writeTripErr(w, derr.ErrRateLimited)
		return
	}
	lat, ok1 := floatParam(r, "lat")
	lng, ok2 := floatParam(r, "lng")
	if !ok1 || !ok2 || lat == nil || lng == nil {
		writeTripErr(w, derr.ErrBadRequest)
		return
	}
	res, err := h.svc.Reverse(r.Context(), *lat, *lng, r.URL.Query().Get("lang"))
	if err != nil {
		writeTripErr(w, err)
		return
	}
	api.WriteJSON(w, http.StatusOK, res)
}
```

Router: add `Places *handlers.PlacesHandler` to `Handlers` and, in the authenticated group:

```go
		if h.Places != nil {
			ar.Get("/places/search", h.Places.Search)
			ar.Get("/places/reverse", h.Places.Reverse)
		}
```

`backend/internal/http/handlers/places_handlers_test.go` (package `handlers_test`; reuse `newTripFixture`'s pieces by building its own router — copy the construction from `newTripFixture` and add `Places: handlers.NewPlacesHandler(svc, ratelimit.New(1000, 1000))` with `svc := places.NewService(nil, nil, m.Places, ratelimit.New(1000,1000))`):

```go
package handlers_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPlacesSearchDegradesWithoutGeocoderAndValidates(t *testing.T) {
	f := newPlacesFixture(t) // builds the router with a nil-geocoder places service; see newTripFixture for the pattern
	get := func(path string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+f.apiKey)
		rec := httptest.NewRecorder()
		f.h.ServeHTTP(rec, req)
		return rec
	}
	rec := get("/places/search?q=kyoto+station")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"degraded":true`) || !strings.Contains(rec.Body.String(), `"results":[]`) {
		t.Fatalf("no geocoder must degrade, got %d %s", rec.Code, rec.Body)
	}
	if rec := get("/places/search?q=ab"); rec.Code != http.StatusBadRequest {
		t.Fatalf("short query: %d", rec.Code)
	}
	if rec := get("/places/search?q=kyoto&lat=abc"); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad lat: %d", rec.Code)
	}
	if rec := get("/places/reverse?lat=35"); rec.Code != http.StatusBadRequest {
		t.Fatalf("missing lng: %d", rec.Code)
	}
	req := httptest.NewRequest(http.MethodGet, "/places/search?q=kyoto", nil)
	rec = httptest.NewRecorder()
	f.h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("auth required: %d", rec.Code)
	}
}
```

Define the fixture in the same file (add imports `context`, `places` = `github.com/janvillarosa/gracie-app/backend/internal/services/places`, plus those already used by `trip_handlers_test.go`; it reuses `tripFixture` from that file). The tests in `places_test.go` already cover timeouts, 5xx and caching against a fake Photon server:

```go
func newPlacesFixture(t *testing.T) tripFixture {
	t.Helper()
	m := memstore.Compose()
	userSvc := services.NewUserService(m.Users, m.Rooms, m.Tx)
	roomSvc := services.NewRoomService(m.Users, m.Rooms, m.Tx)
	listSvc := services.NewListService(m.Users, m.Rooms, m.Lists, m.Items, categorization.NewKeywordCategorizer(categorization.GroceryAnchors))
	authSvc, err := services.NewAuthService(m.Users, "/tmp/gracie-test-enc.key", 720)
	if err != nil {
		t.Fatal(err)
	}
	placesSvc := places.NewService(nil, nil, m.Places, ratelimit.New(1000, 1000)) // nil geocoder => always degraded
	h := router.NewRouter(m.Users, router.Handlers{
		Auth: handlers.NewAuthHandler(authSvc), User: handlers.NewUserHandler(userSvc, []byte("salt")),
		Room: handlers.NewRoomHandler(roomSvc, m.Users, []byte("salt")), List: handlers.NewListHandler(listSvc),
		Places: handlers.NewPlacesHandler(placesSvc, ratelimit.New(1000, 1000)),
	})
	cu, err := userSvc.CreateUserWithSoloRoom(context.Background(), "A")
	if err != nil {
		t.Fatal(err)
	}
	return tripFixture{h: h, apiKey: cu.APIKey, roomID: *cu.User.RoomID}
}
```

- [ ] **Step 7: Run, tidy, commit**

Run: `cd backend && go get github.com/ringsaturn/tzf@latest && go mod tidy && gofmt -w internal && go vet ./... && go test ./... -count=1`
Expected: PASS. Note the added binary/RAM cost: run `go build -o /tmp/gracie-bin ./cmd/gracie-server && ls -lh /tmp/gracie-bin` and record the size in the commit body.

```bash
git add backend
git commit -m "feat(places): Photon proxy with cache, limits and graceful degradation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Wiring, config, docs, final verification

**Files:**
- Modify: `backend/internal/config/config.go`, `backend/cmd/gracie-server/main.go`, `.env.example`, `backend/CLAUDE.md`, `docs/superpowers/specs/2026-10-14-trips-api-persistence-design.md`
- Test: `backend/internal/config/config_test.go` (create if absent)

**Interfaces:**
- Produces config fields `PhotonBaseURL string` (`PHOTON_BASE_URL`, default `""` = places degrade), `TripsUserRPS float64` (`TRIPS_USER_RPS`, default 5), `PlacesUserRPS float64` (`PLACES_USER_RPS`, default 2), `PlacesServerRPS float64` (`PLACES_SERVER_RPS`, default 5), using the existing `getEnv`/`getEnvFloat` helpers.

- [ ] **Step 1: Failing config test**

```go
package config

import "testing"

func TestTripsAndPlacesDefaults(t *testing.T) {
	t.Setenv("MONGODB_URI", "mongodb://x")
	t.Setenv("MONGODB_DB", "x")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PhotonBaseURL != "" || cfg.TripsUserRPS != 5 || cfg.PlacesUserRPS != 2 || cfg.PlacesServerRPS != 5 {
		t.Fatalf("defaults: %+v", cfg)
	}
	t.Setenv("PHOTON_BASE_URL", "https://photon.example")
	t.Setenv("PLACES_SERVER_RPS", "9")
	cfg, _ = Load()
	if cfg.PhotonBaseURL != "https://photon.example" || cfg.PlacesServerRPS != 9 {
		t.Fatalf("overrides: %+v", cfg)
	}
}
```

Run: `cd backend && go test ./internal/config/ -count=1` — Expected: FAIL (unknown fields).

- [ ] **Step 2: Implement config** — add the four fields to `Config` and, in `Load()` after the `CategoryIndexEnabled` line:

```go
	cfg.PhotonBaseURL = getEnv("PHOTON_BASE_URL", "")
	cfg.TripsUserRPS = getEnvFloat("TRIPS_USER_RPS", 5)
	cfg.PlacesUserRPS = getEnvFloat("PLACES_USER_RPS", 2)
	cfg.PlacesServerRPS = getEnvFloat("PLACES_SERVER_RPS", 5)
```

Run the test again — Expected: PASS.

- [ ] **Step 3: Wire `main.go`**

After the existing `_ = itemsRepo.EnsureIndexes(ctx)` line add:

```go
	tripsRepo := mongostore.NewTripRepo(mcli)
	placeCacheRepo := mongostore.NewPlaceCacheRepo(mcli)
	if err := tripsRepo.EnsureIndexes(ctx); err != nil {
		log.Fatalf("trips: ensure indexes: %v", err)
	}
	if err := placeCacheRepo.EnsureIndexes(ctx); err != nil {
		log.Printf("place_cache: ensure indexes failed: %v (continuing)", err)
	}
```

After `userSvc.UseListRepos(listsRepo, itemsRepo)` add `roomSvc.UseTripRepo(tripsRepo)` and `userSvc.UseTripRepo(tripsRepo)`. After `listSvc` is built add:

```go
	tripSvc := services.NewTripService(roomsRepo, tripsRepo, listSvc, listsRepo)

	var geo places.Geocoder
	if cfg.PhotonBaseURL != "" {
		geo = places.NewPhoton(cfg.PhotonBaseURL, "Bauhouse/1.0 (+https://github.com/janvillarosa/gracie-app)", 2*time.Second, nil)
	} else {
		log.Printf("places: PHOTON_BASE_URL unset; place search will report degraded")
	}
	tz, err := places.NewTZF()
	if err != nil {
		log.Printf("places: timezone finder unavailable: %v", err)
		tz = nil
	}
	placesSvc := places.NewService(geo, tz, placeCacheRepo, ratelimit.New(cfg.PlacesServerRPS, int(cfg.PlacesServerRPS)*4))
```

and update the handler construction/`NewRouter` call:

```go
	tripHandler := handlers.NewTripHandler(tripSvc, ratelimit.New(cfg.TripsUserRPS, int(cfg.TripsUserRPS)*4))
	placesHandler := handlers.NewPlacesHandler(placesSvc, ratelimit.New(cfg.PlacesUserRPS, int(cfg.PlacesUserRPS)*4))

	r := router.NewRouter(usersRepo, router.Handlers{Auth: authHandler, User: userHandler, Room: roomHandler, List: listHandler, Trip: tripHandler, Places: placesHandler})
```

Add imports for `internal/ratelimit` and `internal/services/places`. When `tz` is a nil `places.TZResolver` interface the service's `s.tz != nil` check in `fillTZ` handles it; make sure you assign the typed `nil` to the interface variable exactly as shown (`tz = nil` with `tz` declared as `places.TZResolver` by `NewTZF`'s return type).

- [ ] **Step 4: `.env.example`** — append:

```bash
# ── Backend: Trips & places ─────────────────────────────────────────────────
# Photon-compatible geocoder base URL for place search. Public photon.komoot.io is
# fair-use only; self-host or use a commercial OSM provider in production.
# When unset, /places/* return {"results":[],"degraded":true} and clients fall back
# to manual places / dropped pins.
# PHOTON_BASE_URL=https://photon.komoot.io
# Per-user and server-wide request rates (tokens/second; burst is 4x).
TRIPS_USER_RPS=5
PLACES_USER_RPS=2
PLACES_SERVER_RPS=5
```

- [ ] **Step 5: Docs**

In `backend/CLAUDE.md`: add `trips` (pure op engine) and `ratelimit` to the Architecture bullets; add `Trip` models to the `models` bullet; and add a **Trips (offline-first sync)** section covering: one aggregate document per trip; all writes via `POST /rooms/{id}/trips/ops` (typed patches, per-device `seq` idempotency, per-field `at` clocks, tombstones, soft delete + restore); `POST .../trips/sync` with `known: {trip_id: version}` returning per-entity deltas, `removed` and a `base_version` the client must match (otherwise resync); the **client rules**: drop ops that come back `rejected`/`unsupported` and revert their optimistic state, keep `retry`, treat `duplicate` as acked, surface `conflicted` with `skipped_fields`; and the invariants "never add a write path to `trips` that bypasses `ApplyOp` + `ReplaceCAS`" and "trip handlers use `tripStatus` (500 default), not `statusFromErr`".

Amend the spec (`docs/superpowers/specs/2026-10-14-trips-api-persistence-design.md`) with three precision notes: (1) the manifest index also carries `deleted_by`; (2) op responses include `base_version` on each `TripDelta`, plus `deleted`/`deleted_by` flags; (3) the packing-list link is repaired by `POST .../packing-list` (the sync payload returns the stored id and does not check the List exists).

- [ ] **Step 6: Full verification**

Run, from the repo root:

```bash
make check
make test-integration
cd backend && go test -race ./internal/trips/ ./internal/services/ ./internal/ratelimit/ -count=1
```
Expected: all PASS; the integration run must actually execute the Mongo tests (not skip). If coverage ratchets fail on the frontend, they are unrelated — do not touch `frontend/`; report it.

- [ ] **Step 7: Commit**

```bash
git add -A backend docs .env.example
git commit -m "feat(trips): wire services, config, env and docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage** (spec section → task): Core approach / data model → T3; ops table, results, creates, conflicts → T4–T7; delta sync + tombstones + `tomb_floor` → T8, T10; API endpoints → T10, T15; packing list → T11; places proxy (limits, rounding, cache, degrade, tz, UA, 256 KB cap) → T16; transport (Compress, MaxBytesReader, rate limit, 500 mapper) → T14–T15; room lifecycle (cleanup, move-on-join) → T12; indexes (incl. TTL) → T13; refactor commits first → T1–T2; files/docs/env → T17; verification list → tests in T4–T16, size measurement in T13.

**Spec deltas made explicit** (recorded in T17's spec amendment): index gains `deleted_by`; `TripDelta.base_version`/`deleted`/`deleted_by`; stale packing-list links are repaired on `POST .../packing-list`, not in sync; reverse-geocode results are deliberately not cached (exact pin coordinates).

**Type consistency check:** `Ctx{Actor, Now, NewV}` / `Outcome{Dirty, Bump}` (T5) are used identically in T10; `DeltaSince(t, known, present)` (T8) in T10; `TripRepository` method set (T9) matches both fakes and the Mongo repo (T13) and the wrappers in T10/T11 tests; `ErrRateLimited` is added in T10 and used in T15–T16; `router.Handlers` gains `Trip` (T15) and `Places` (T16); `ensureRoomMembership(ctx, rooms, user, roomID)` (T2) is used by T10–T11.

**Known external risk:** the `ringsaturn/tzf` API (T16 step 4) is the only symbol not verified against source; the task tells the implementer to confirm with `go doc` and confines any adaptation to `tz.go`.
