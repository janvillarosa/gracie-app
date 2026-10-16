package services

import (
	"context"
	"log"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
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
	trips store.TripRepository
	tx    store.TxRunner
	emitter
}

func NewRoomService(users store.UserRepository, rooms store.RoomRepository, tx store.TxRunner) *RoomService {
	return &RoomService{users: users, rooms: rooms, tx: tx}
}

// UseListRepos injects optional list repositories used for cleanup when a room is deleted.
func (s *RoomService) UseListRepos(lists store.ListRepository, items store.ListItemRepository) {
	s.lists, s.items = lists, items
}

func (s *RoomService) GetMyRoom(ctx context.Context, user *models.User) (*models.Room, error) {
	if user.RoomID == nil || *user.RoomID == "" {
		return nil, derr.ErrNotFound
	}
	return s.rooms.GetByID(ctx, *user.RoomID)
}

func (s *RoomService) CreateSoloRoom(ctx context.Context, user *models.User) (*models.Room, error) {
	if user.RoomID != nil && *user.RoomID != "" {
		return nil, derr.ErrConflict
	}
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
		if err := s.rooms.Put(txctx, room); err != nil {
			return err
		}
		return s.users.SetRoomID(txctx, user.UserID, &room.RoomID, now)
	}); err != nil {
		return nil, err
	}
	s.emitHouse(ctx, "house.created", user, room.RoomID, nil)
	return room, nil
}

func (s *RoomService) RotateShareToken(ctx context.Context, user *models.User) (string, error) {
	if user.RoomID == nil || *user.RoomID == "" {
		return "", derr.ErrNotFound
	}
	token := ids.NewShareToken5()
	if err := s.rooms.SetShareToken(ctx, *user.RoomID, user.UserID, token, time.Now().UTC()); err != nil {
		return "", err
	}
	s.emitHouse(ctx, "house.invite_rotated", user, *user.RoomID, nil)
	return token, nil
}

// CurrentShareToken returns the House's invite code, minting one only when it has none. Reading
// it never invalidates a code already handed out; RotateShareToken is the explicit "new code".
func (s *RoomService) CurrentShareToken(ctx context.Context, user *models.User) (string, error) {
	if user.RoomID == nil || *user.RoomID == "" {
		return "", derr.ErrNotFound
	}
	return s.rooms.SetShareTokenIfAbsent(ctx, *user.RoomID, user.UserID, ids.NewShareToken5(), time.Now().UTC())
}

// JoinRoom joins the authenticated user to the target room using a token.
func (s *RoomService) JoinRoom(ctx context.Context, joiner *models.User, roomID, token string) (*models.Room, error) {
	now := time.Now().UTC()
	rm, err := s.rooms.GetByID(ctx, roomID)
	if err != nil {
		return nil, err
	}
	if rm.ShareToken == nil || *rm.ShareToken == "" || token == "" || token != *rm.ShareToken {
		return nil, derr.ErrForbidden
	}
	// Disallow joining the same room twice
	for _, mid := range rm.MemberIDs {
		if mid == joiner.UserID {
			return nil, derr.ErrConflict
		}
	}

	var deleteSolo *models.Room
	if joiner.RoomID != nil && *joiner.RoomID != "" {
		jr, err := s.rooms.GetByID(ctx, *joiner.RoomID)
		if err != nil {
			return nil, err
		}
		// If the joiner currently has a solo room (only them), delete it post-join.
		if len(jr.MemberIDs) == 1 && jr.MemberIDs[0] == joiner.UserID {
			deleteSolo = jr
		}
	}
	if err := s.tx.WithTransaction(ctx, func(txctx context.Context) error {
		if err := s.rooms.AddMember(txctx, rm.RoomID, joiner.UserID, now); err != nil {
			return err
		}
		if err := s.rooms.RemoveShareToken(txctx, rm.RoomID, now); err != nil {
			return err
		}
		if err := s.users.SetRoomID(txctx, joiner.UserID, &rm.RoomID, now); err != nil {
			return err
		}
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
	}); err != nil {
		return nil, err
	}
	if deleteSolo != nil && s.purger != nil {
		// The solo house is gone; the person's own events stay (their profile is built from them).
		if err := s.purger.ForgetRoomAggregates(ctx, deleteSolo.RoomID); err != nil {
			log.Printf("analytics: forget house %s: %v", deleteSolo.RoomID, err)
		}
	}
	s.emitHouse(ctx, "house.joined", joiner, rm.RoomID, nil)
	return s.rooms.GetByID(ctx, rm.RoomID)
}

func (s *RoomService) JoinRoomByToken(ctx context.Context, joiner *models.User, token string) (*models.Room, error) {
	if token == "" {
		return nil, derr.ErrBadRequest
	}
	rm, err := s.rooms.GetByShareToken(ctx, token)
	if err != nil {
		return nil, err
	}
	return s.JoinRoom(ctx, joiner, rm.RoomID, token)
}

func (s *RoomService) VoteDeletion(ctx context.Context, voter *models.User) (bool, error) {
	if voter.RoomID == nil || *voter.RoomID == "" {
		return false, derr.ErrNotFound
	}
	now := time.Now().UTC()
	if err := s.rooms.VoteDeletion(ctx, *voter.RoomID, voter.UserID, now); err != nil {
		return false, err
	}
	s.emitHouse(ctx, "house.delete_voted", voter, *voter.RoomID, nil)
	rm, err := s.rooms.GetByID(ctx, *voter.RoomID)
	if err != nil {
		return false, err
	}
	// Delete when ALL current members have voted (works for solo rooms too)
	allVoted := true
	for _, mid := range rm.MemberIDs {
		if rm.DeletionVotes[mid] == "" {
			allVoted = false
			break
		}
	}
	if !allVoted {
		return false, nil
	}
	if err := s.tx.WithTransaction(ctx, func(txctx context.Context) error {
		if err := s.rooms.Delete(txctx, rm.RoomID); err != nil {
			return err
		}
		for _, mid := range rm.MemberIDs {
			if err := s.users.SetRoomID(txctx, mid, nil, now); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return false, err
	}
	s.emitHouse(ctx, "house.deleted", voter, rm.RoomID, nil)
	go s.cleanupRoomResources(context.Background(), rm.RoomID)
	return true, nil
}

func (s *RoomService) CancelDeletionVote(ctx context.Context, user *models.User) error {
	if user.RoomID == nil || *user.RoomID == "" {
		return derr.ErrNotFound
	}
	if err := s.rooms.RemoveDeletionVote(ctx, *user.RoomID, user.UserID); err != nil {
		return err
	}
	s.emitHouse(ctx, "house.delete_vote_cancelled", user, *user.RoomID, nil)
	return nil
}

// UpdateRoomSettings updates display name and/or description.
func (s *RoomService) UpdateRoomSettings(ctx context.Context, user *models.User, displayName *string, description *string) error {
	if user.RoomID == nil || *user.RoomID == "" {
		return derr.ErrNotFound
	}
	now := time.Now().UTC()
	var changed []string
	if displayName != nil {
		changed = append(changed, "display_name")
		if err := s.rooms.UpdateDisplayName(ctx, *user.RoomID, user.UserID, *displayName, now); err != nil {
			return err
		}
	}
	if description != nil {
		changed = append(changed, "description")
		if err := s.rooms.UpdateDescription(ctx, *user.RoomID, user.UserID, *description, now); err != nil {
			return err
		}
	}
	if len(changed) > 0 {
		s.emitHouse(ctx, "house.settings_updated", user, *user.RoomID, fieldsProp(changed))
	}
	return nil
}

func (s *RoomService) cleanupRoomResources(ctx context.Context, roomID string) {
	s.purgeRoom(ctx, roomID)
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

// UseTripRepo injects the optional trip repository used to re-home and clean up trips.
func (s *RoomService) UseTripRepo(trips store.TripRepository) { s.trips = trips }

// emitHouse records a house event. The house is its own subject and carries no container.
func (s *RoomService) emitHouse(ctx context.Context, name string, user *models.User, roomID string, props map[string]any) {
	s.emit(ctx, analytics.Event{Name: name, ActorID: user.UserID, RoomID: roomID, Subject: analytics.Ref{Type: "house", ID: roomID}, Props: props})
}
