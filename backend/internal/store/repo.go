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
    SetRoomID(ctx context.Context, userID string, roomID *string, updatedAt time.Time) error
}

type RoomRepository interface {
    Put(ctx context.Context, r *models.Room) error
    GetByID(ctx context.Context, id string) (*models.Room, error)
    GetByShareToken(ctx context.Context, token string) (*models.Room, error)
    SetShareToken(ctx context.Context, roomID string, userID string, token string, updatedAt time.Time) error
    RemoveShareToken(ctx context.Context, roomID string, updatedAt time.Time) error
    UpdateDescription(ctx context.Context, roomID string, userID string, description string, updatedAt time.Time) error
    UpdateDisplayName(ctx context.Context, roomID string, userID string, displayName string, updatedAt time.Time) error
    VoteDeletion(ctx context.Context, roomID string, userID string, ts time.Time) error
    RemoveDeletionVote(ctx context.Context, roomID string, userID string) error
    Delete(ctx context.Context, roomID string) error
    AddMember(ctx context.Context, roomID string, userID string, updatedAt time.Time) error
}

type ListRepository interface {
    Put(ctx context.Context, l *models.List) error
    GetByID(ctx context.Context, id string) (*models.List, error)
    ListByRoom(ctx context.Context, roomID string) ([]models.List, error)
    AddDeletionVote(ctx context.Context, listID string, userID string, ts time.Time) error
    RemoveDeletionVote(ctx context.Context, listID string, userID string) error
    FinalizeDeleteIfBothVoted(ctx context.Context, listID, uid1, uid2 string, ts time.Time) (bool, error)
    Delete(ctx context.Context, listID string) error
}

type ListItemRepository interface {
    Put(ctx context.Context, it *models.ListItem) error
    GetByID(ctx context.Context, id string) (*models.ListItem, error)
    ListByList(ctx context.Context, listID string) ([]models.ListItem, error)
    UpdateCompletion(ctx context.Context, itemID string, completed bool, updatedAt time.Time) error
    UpdateDescription(ctx context.Context, itemID string, description string, updatedAt time.Time) error
    Delete(ctx context.Context, itemID string) error
}

