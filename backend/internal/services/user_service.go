package services

import (
    "context"
    "regexp"
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
    lists store.ListRepository
    items store.ListItemRepository
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

// UseListRepos injects optional list repositories used for cleanup when a room is deleted.
func (s *UserService) UseListRepos(lists store.ListRepository, items store.ListItemRepository) { s.lists, s.items = lists, items }

var emailRe2 = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

// UpdateProfile updates name and/or username (email). Pre-checks username uniqueness.
func (s *UserService) UpdateProfile(ctx context.Context, userID string, name *string, username *string) error {
    now := time.Now().UTC()
    if name == nil && username == nil { return derr.ErrBadRequest }
    if name != nil && *name == "" { return derr.ErrBadRequest }
    if username != nil {
        if *username == "" || !emailRe2.MatchString(*username) { return derr.ErrBadRequest }
        // Ensure not taken by another user
        if u, err := s.users.GetByUsername(ctx, *username); err == nil && u != nil && u.UserID != userID {
            return derr.ErrConflict
        }
        if err := s.users.UpdateUsername(ctx, userID, *username, now); err != nil { return err }
    }
    if name != nil {
        if err := s.users.UpdateName(ctx, userID, *name, now); err != nil { return err }
    }
    return nil
}

// DeleteAccount removes the user and detaches them from any room. If their room would
// become empty, delete the room and (optionally) cleanup lists.
func (s *UserService) DeleteAccount(ctx context.Context, userID string) error {
    u, err := s.users.GetByID(ctx, userID)
    if err != nil { return err }
    now := time.Now().UTC()
    var deletedRoomID string
    if u.RoomID != nil && *u.RoomID != "" {
        rm, err := s.rooms.GetByID(ctx, *u.RoomID)
        if err != nil { return err }
        if len(rm.MemberIDs) <= 1 {
            // Solo room: delete room then delete user
            if err := s.tx.WithTransaction(ctx, func(txctx context.Context) error {
                if err := s.rooms.Delete(txctx, rm.RoomID); err != nil { return err }
                // Clear room_id then delete user
                if err := s.users.SetRoomID(txctx, u.UserID, nil, now); err != nil { return err }
                if err := s.users.Delete(txctx, u.UserID); err != nil { return err }
                return nil
            }); err != nil { return err }
            deletedRoomID = rm.RoomID
        } else {
            // Shared room: remove membership and delete user
            if err := s.tx.WithTransaction(ctx, func(txctx context.Context) error {
                if err := s.rooms.RemoveMember(txctx, rm.RoomID, u.UserID, now); err != nil { return err }
                _ = s.rooms.RemoveDeletionVote(txctx, rm.RoomID, u.UserID)
                if err := s.users.SetRoomID(txctx, u.UserID, nil, now); err != nil { return err }
                if err := s.users.Delete(txctx, u.UserID); err != nil { return err }
                return nil
            }); err != nil { return err }
        }
    } else {
        // No room: delete user only
        if err := s.users.Delete(ctx, u.UserID); err != nil { return err }
    }
    if deletedRoomID != "" {
        go s.cleanupRoomResources(context.Background(), deletedRoomID)
    }
    return nil
}

func (s *UserService) cleanupRoomResources(ctx context.Context, roomID string) {
    if s.lists == nil { return }
    lists, err := s.lists.ListByRoom(ctx, roomID)
    if err != nil { return }
    for _, l := range lists { _ = s.lists.Delete(ctx, l.ListID) }
}
