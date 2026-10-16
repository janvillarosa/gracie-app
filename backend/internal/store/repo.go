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
	RemoveShareToken(ctx context.Context, roomID string, updatedAt time.Time) error
	UpdateDescription(ctx context.Context, roomID string, userID string, description string, updatedAt time.Time) error
	UpdateDisplayName(ctx context.Context, roomID string, userID string, displayName string, updatedAt time.Time) error
	SetSuggestionsOff(ctx context.Context, roomID string, userID string, off bool, updatedAt time.Time) error
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
