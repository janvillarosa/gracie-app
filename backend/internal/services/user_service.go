package services

import (
    "context"
    "time"

    authpkg "github.com/janvillarosa/gracie-app/backend/internal/auth"
    derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
    "github.com/janvillarosa/gracie-app/backend/internal/models"
    "github.com/janvillarosa/gracie-app/backend/internal/store"
    "github.com/janvillarosa/gracie-app/backend/pkg/ids"
)

type UserService struct {
    users store.UserRepository
    rooms store.RoomRepository
    tx    store.TxRunner
}

func NewUserService(users store.UserRepository, rooms store.RoomRepository, tx store.TxRunner) *UserService {
    return &UserService{users: users, rooms: rooms, tx: tx}
}

type CreatedUser struct {
	User   *models.User
	APIKey string
}

func (s *UserService) CreateUserWithSoloRoom(ctx context.Context, name string) (*CreatedUser, error) {
    now := time.Now().UTC()

    userID := ids.NewID("usr")
    roomID := ids.NewID("room")

    apiKey, apiHash, err := authpkg.GenerateAPIKey()
    if err != nil {
        return nil, err
    }
    lookup := authpkg.DeriveLookup(apiKey)

    user := &models.User{
        UserID:       userID,
        Name:         name,
        APIKeyHash:   apiHash,
        APIKeyLookup: lookup,
        RoomID:       &roomID,
        CreatedAt:    now,
        UpdatedAt:    now,
    }
    room := &models.Room{
        RoomID:        roomID,
        MemberIDs:     []string{userID},
        DeletionVotes: map[string]string{},
        CreatedAt:     now,
        UpdatedAt:     now,
    }

    if err := s.tx.WithTransaction(ctx, func(txctx context.Context) error {
        if err := s.users.Put(txctx, user); err != nil { return err }
        if err := s.rooms.Put(txctx, room); err != nil { return err }
        return nil
    }); err != nil {
        return nil, err
    }
    return &CreatedUser{User: user, APIKey: apiKey}, nil
}

func (s *UserService) GetMe(ctx context.Context, userID string) (*models.User, error) { return s.users.GetByID(ctx, userID) }

func (s *UserService) UpdateName(ctx context.Context, userID string, name string) error {
    if name == "" { return derr.ErrBadRequest }
    return s.users.UpdateName(ctx, userID, name, time.Now().UTC())
}
