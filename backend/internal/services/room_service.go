package services

import (
    "context"
    "time"

    derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
    "github.com/janvillarosa/gracie-app/backend/internal/models"
    "github.com/janvillarosa/gracie-app/backend/internal/store"
    "github.com/janvillarosa/gracie-app/backend/pkg/ids"
)

type RoomService struct {
    users store.UserRepository
    rooms store.RoomRepository
    lists store.ListRepository
    items store.ListItemRepository
    tx    store.TxRunner
}

func NewRoomService(users store.UserRepository, rooms store.RoomRepository, tx store.TxRunner) *RoomService {
    return &RoomService{users: users, rooms: rooms, tx: tx}
}

// UseListRepos injects optional list repositories used for cleanup when a room is deleted.
func (s *RoomService) UseListRepos(lists store.ListRepository, items store.ListItemRepository) { s.lists, s.items = lists, items }

func (s *RoomService) GetMyRoom(ctx context.Context, user *models.User) (*models.Room, error) {
    if user.RoomID == nil || *user.RoomID == "" { return nil, derr.ErrNotFound }
    return s.rooms.GetByID(ctx, *user.RoomID)
}

func (s *RoomService) CreateSoloRoom(ctx context.Context, user *models.User) (*models.Room, error) {
    if user.RoomID != nil && *user.RoomID != "" { return nil, derr.ErrConflict }
    now := time.Now().UTC()
    room := &models.Room{
        RoomID:        ids.NewID("room"),
        MemberIDs:     []string{user.UserID},
        DeletionVotes: map[string]string{},
        DisplayName:   "My Room",
        Description:   "",
        CreatedAt:     now,
        UpdatedAt:     now,
    }
    if err := s.tx.WithTransaction(ctx, func(txctx context.Context) error {
        if err := s.rooms.Put(txctx, room); err != nil { return err }
        return s.users.SetRoomID(txctx, user.UserID, &room.RoomID, now)
    }); err != nil { return nil, err }
    return room, nil
}

func (s *RoomService) RotateShareToken(ctx context.Context, user *models.User) (string, error) {
    if user.RoomID == nil || *user.RoomID == "" { return "", derr.ErrNotFound }
    token := ids.NewShareToken5()
    if err := s.rooms.SetShareToken(ctx, *user.RoomID, user.UserID, token, time.Now().UTC()); err != nil { return "", err }
    return token, nil
}

// JoinRoom joins the authenticated user to the target room using a token.
func (s *RoomService) JoinRoom(ctx context.Context, joiner *models.User, roomID, token string) (*models.Room, error) {
    now := time.Now().UTC()
    rm, err := s.rooms.GetByID(ctx, roomID)
    if err != nil { return nil, err }
    if rm.ShareToken == nil || *rm.ShareToken == "" || token == "" || token != *rm.ShareToken { return nil, derr.ErrForbidden }
    // Disallow joining the same room twice
    for _, mid := range rm.MemberIDs { if mid == joiner.UserID { return nil, derr.ErrConflict } }

    var deleteSolo *models.Room
    if joiner.RoomID != nil && *joiner.RoomID != "" {
        jr, err := s.rooms.GetByID(ctx, *joiner.RoomID)
        if err != nil { return nil, err }
        // If the joiner currently has a solo room (only them), delete it post-join.
        if len(jr.MemberIDs) == 1 && jr.MemberIDs[0] == joiner.UserID {
            deleteSolo = jr
        }
    }
    if err := s.tx.WithTransaction(ctx, func(txctx context.Context) error {
        if err := s.rooms.AddMember(txctx, rm.RoomID, joiner.UserID, now); err != nil { return err }
        if err := s.rooms.RemoveShareToken(txctx, rm.RoomID, now); err != nil { return err }
        if err := s.users.SetRoomID(txctx, joiner.UserID, &rm.RoomID, now); err != nil { return err }
        if deleteSolo != nil { return s.rooms.Delete(txctx, deleteSolo.RoomID) }
        return nil
    }); err != nil { return nil, err }
    return s.rooms.GetByID(ctx, rm.RoomID)
}

func (s *RoomService) JoinRoomByToken(ctx context.Context, joiner *models.User, token string) (*models.Room, error) {
    if token == "" { return nil, derr.ErrBadRequest }
    rm, err := s.rooms.GetByShareToken(ctx, token)
    if err != nil { return nil, err }
    return s.JoinRoom(ctx, joiner, rm.RoomID, token)
}

func (s *RoomService) VoteDeletion(ctx context.Context, voter *models.User) (bool, error) {
    if voter.RoomID == nil || *voter.RoomID == "" { return false, derr.ErrNotFound }
    now := time.Now().UTC()
    if err := s.rooms.VoteDeletion(ctx, *voter.RoomID, voter.UserID, now); err != nil { return false, err }
    rm, err := s.rooms.GetByID(ctx, *voter.RoomID)
    if err != nil { return false, err }
    // Delete when ALL current members have voted (works for solo rooms too)
    allVoted := true
    for _, mid := range rm.MemberIDs {
        if rm.DeletionVotes[mid] == "" {
            allVoted = false
            break
        }
    }
    if !allVoted { return false, nil }
    if err := s.tx.WithTransaction(ctx, func(txctx context.Context) error {
        if err := s.rooms.Delete(txctx, rm.RoomID); err != nil { return err }
        for _, mid := range rm.MemberIDs {
            if err := s.users.SetRoomID(txctx, mid, nil, now); err != nil { return err }
        }
        return nil
    }); err != nil { return false, err }
    go s.cleanupRoomResources(context.Background(), rm.RoomID)
    return true, nil
}

func (s *RoomService) CancelDeletionVote(ctx context.Context, user *models.User) error {
    if user.RoomID == nil || *user.RoomID == "" { return derr.ErrNotFound }
    return s.rooms.RemoveDeletionVote(ctx, *user.RoomID, user.UserID)
}

// UpdateRoomSettings updates display name and/or description.
func (s *RoomService) UpdateRoomSettings(ctx context.Context, user *models.User, displayName *string, description *string) error {
    if user.RoomID == nil || *user.RoomID == "" { return derr.ErrNotFound }
    now := time.Now().UTC()
    if displayName != nil {
        if err := s.rooms.UpdateDisplayName(ctx, *user.RoomID, user.UserID, *displayName, now); err != nil { return err }
    }
    if description != nil {
        if err := s.rooms.UpdateDescription(ctx, *user.RoomID, user.UserID, *description, now); err != nil { return err }
    }
    return nil
}

func (s *RoomService) cleanupRoomResources(ctx context.Context, roomID string) {
    if s.lists == nil { return }
    lists, err := s.lists.ListByRoom(ctx, roomID)
    if err != nil { return }
    for _, l := range lists { _ = s.lists.Delete(ctx, l.ListID) }
}
