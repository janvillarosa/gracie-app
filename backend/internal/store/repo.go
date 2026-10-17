package store

import (
	"context"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

// TxRunner provides transaction support for multi-document operations.
type TxRunner interface {
	WithTransaction(ctx context.Context, fn func(ctx context.Context) error) error
}

type UserRepository interface {
	Put(ctx context.Context, u *models.User) error
	GetByID(ctx context.Context, id string) (*models.User, error)
	GetByUsername(ctx context.Context, username string) (*models.User, error)
	GetByAPIKeyLookup(ctx context.Context, lookup string) (*models.User, error)
	SetAPIKey(ctx context.Context, userID string, hash, lookup string, expiresAt *time.Time, updatedAt time.Time) error
	UpdateName(ctx context.Context, userID string, name string, updatedAt time.Time) error
	// UpdateTZ records the last-seen IANA zone without touching updated_at.
	UpdateTZ(ctx context.Context, userID string, tz string) error
	// UpdatePreferences sets only the non-nil preference fields (nested $set), leaving the rest untouched.
	UpdatePreferences(ctx context.Context, userID string, prefs models.UserPreferences, updatedAt time.Time) error
	SetRoomID(ctx context.Context, userID string, roomID *string, updatedAt time.Time) error
	UpdateUsername(ctx context.Context, userID string, username string, updatedAt time.Time) error
	UpdatePasswordEnc(ctx context.Context, userID string, enc string, updatedAt time.Time) error
	Delete(ctx context.Context, userID string) error
}

type RoomRepository interface {
	Put(ctx context.Context, r *models.Room) error
	GetByID(ctx context.Context, id string) (*models.Room, error)
	GetByShareToken(ctx context.Context, token string) (*models.Room, error)
	SetShareToken(ctx context.Context, roomID string, userID string, token string, updatedAt time.Time) error
	// SetShareTokenIfAbsent sets token only when the room has no share token, atomically, and
	// returns the token the room holds afterwards (the existing one, or this one).
	SetShareTokenIfAbsent(ctx context.Context, roomID string, userID string, token string, updatedAt time.Time) (string, error)
	RemoveShareToken(ctx context.Context, roomID string, updatedAt time.Time) error
	UpdateDescription(ctx context.Context, roomID string, userID string, description string, updatedAt time.Time) error
	UpdateDisplayName(ctx context.Context, roomID string, userID string, displayName string, updatedAt time.Time) error
	// SetAutopilotMode stores the house's autopilot mode and clears the older suggestions_off flag.
	SetAutopilotMode(ctx context.Context, roomID string, userID string, mode string, updatedAt time.Time) error
	// ListIDsByAutopilotMode returns up to limit ids of houses that stored this mode (houses that
	// never chose one are not listed: absent means suggest).
	ListIDsByAutopilotMode(ctx context.Context, mode string, limit int) ([]string, error)
	VoteDeletion(ctx context.Context, roomID string, userID string, ts time.Time) error
	RemoveDeletionVote(ctx context.Context, roomID string, userID string) error
	Delete(ctx context.Context, roomID string) error
	AddMember(ctx context.Context, roomID string, userID string, updatedAt time.Time) error
	RemoveMember(ctx context.Context, roomID string, userID string, updatedAt time.Time) error
}

type ListRepository interface {
	Put(ctx context.Context, l *models.List) error
	GetByID(ctx context.Context, id string) (*models.List, error)
	ListByRoom(ctx context.Context, roomID string) ([]models.List, error)
	UpdateName(ctx context.Context, listID string, name string, updatedAt time.Time) error
	UpdateDescription(ctx context.Context, listID string, description string, updatedAt time.Time) error
	UpdateNotes(ctx context.Context, listID string, notes string, updatedAt time.Time) error
	UpdateIcon(ctx context.Context, listID string, icon string, updatedAt time.Time) error
	AddDeletionVote(ctx context.Context, listID string, userID string, ts time.Time) error
	RemoveDeletionVote(ctx context.Context, listID string, userID string) error
	FinalizeDeleteIfVotedByAll(ctx context.Context, listID string, memberIDs []string, ts time.Time) (bool, error)
	Delete(ctx context.Context, listID string) error
}

type ListItemRepository interface {
	Put(ctx context.Context, it *models.ListItem) error
	GetByID(ctx context.Context, id string) (*models.ListItem, error)
	ListByList(ctx context.Context, listID string) ([]models.ListItem, error)
	// UpdateCompletion also stamps completed_at/completed_by (or clears them on uncheck).
	UpdateCompletion(ctx context.Context, itemID string, completed bool, actorID string, updatedAt time.Time) error
	UpdateDescription(ctx context.Context, itemID string, description string, updatedAt time.Time) error
	UpdateQuantity(ctx context.Context, itemID string, quantity string, updatedAt time.Time) error
	UpdateUnit(ctx context.Context, itemID string, unit string, updatedAt time.Time) error
	UpdateCategory(ctx context.Context, itemID string, category string, updatedAt time.Time) error
	UpdateStarred(ctx context.Context, itemID string, starred bool, updatedAt time.Time) error
	// ArchiveCompletedByList returns how many items it archived.
	ArchiveCompletedByList(ctx context.Context, listID string, updatedAt time.Time) (int64, error)
	ListArchivedByRoom(ctx context.Context, roomID string) ([]models.ListItem, error)
	// ListByRoom returns every item in the room (active and archived), newest first.
	ListByRoom(ctx context.Context, roomID string) ([]models.ListItem, error)
	UpdateOrder(ctx context.Context, itemID string, order float64, updatedAt time.Time) error
	Delete(ctx context.Context, itemID string) error
}

// AutopilotActionRepository is the durable log of what autopilot applied.
type AutopilotActionRepository interface {
	// Insert returns derr.ErrConflict when (room_id, kind, key, cycle) already has an action.
	Insert(ctx context.Context, a *models.AutopilotAction) error
	SetItem(ctx context.Context, actionID, itemID string) error
	// Delete removes an action whose item could not be created, so a later tick may try again.
	Delete(ctx context.Context, actionID string) error
	GetByID(ctx context.Context, actionID string) (*models.AutopilotAction, error)
	// GetByItem returns derr.ErrNotFound when no action created the item.
	GetByItem(ctx context.Context, itemID string) (*models.AutopilotAction, error)
	// ListByList returns the list's actions created since `since`, newest first.
	ListByList(ctx context.Context, listID string, since time.Time) ([]models.AutopilotAction, error)
	// ListApplied returns the house's actions still in state applied.
	ListApplied(ctx context.Context, roomID string) ([]models.AutopilotAction, error)
	// Resolve moves an action to `to` only if its state is one of `from`, stamping resolved_at and
	// purge_at; it reports whether it moved.
	Resolve(ctx context.Context, actionID string, from []string, to string, at time.Time) (bool, error)
	DeleteByRoom(ctx context.Context, roomID string) error
	// AcquireLease takes the ticker lease for owner when it is free, expired or already owner's.
	AcquireLease(ctx context.Context, owner string, ttl time.Duration, now time.Time) (bool, error)
}

// AutopilotRetention is how long a resolved action is kept (its key blocks a re-add meanwhile).
const AutopilotRetention = 180 * 24 * time.Hour

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
	// ListCoordsExpired returns up to limit trips (including soft-deleted ones) whose stored
	// Google coordinates were due to expire before `before`. Served from an index on coords_expire_at.
	ListCoordsExpired(ctx context.Context, before time.Time, limit int) ([]models.Trip, error)
}

// BackfillReader is a read-only walk over every domain document, used by the analytics
// backfill. It is separate from the request-path repositories so they don't grow
// "iterate everything" methods. An empty roomID means all houses; callbacks run in a
// stable order and stop the walk by returning an error.
type BackfillReader interface {
	// EachUser omits credential fields. With a roomID it yields that house's current members.
	EachUser(ctx context.Context, roomID string, fn func(models.User) error) error
	EachRoom(ctx context.Context, roomID string, fn func(models.Room) error) error
	// EachList includes soft-deleted lists.
	EachList(ctx context.Context, roomID string, fn func(models.List) error) error
	// EachItem includes completed and archived items.
	EachItem(ctx context.Context, roomID string, fn func(models.ListItem) error) error
	// EachTrip includes soft-deleted trips.
	EachTrip(ctx context.Context, roomID string, fn func(models.Trip) error) error
}
