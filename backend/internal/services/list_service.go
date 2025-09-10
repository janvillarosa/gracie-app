package services

import (
    "context"
    "time"

    derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
    "github.com/janvillarosa/gracie-app/backend/internal/models"
    "github.com/janvillarosa/gracie-app/backend/internal/store"
    "github.com/janvillarosa/gracie-app/backend/pkg/ids"
)

type ListService struct {
    users store.UserRepository
    rooms store.RoomRepository
    lists store.ListRepository
    items store.ListItemRepository
}

func NewListService(users store.UserRepository, rooms store.RoomRepository, lists store.ListRepository, items store.ListItemRepository) *ListService {
    return &ListService{users: users, rooms: rooms, lists: lists, items: items}
}

func (s *ListService) ensureRoomMembership(ctx context.Context, user *models.User, roomID string) error {
    if user.RoomID == nil || *user.RoomID == "" { return derr.ErrForbidden }
    if *user.RoomID != roomID { return derr.ErrForbidden }
    rm, err := s.rooms.GetByID(ctx, roomID)
    if err != nil { return err }
    // verify membership
    isMember := false
    for _, mid := range rm.MemberIDs { if mid == user.UserID { isMember = true; break } }
    if !isMember { return derr.ErrForbidden }
    return nil
}

// Lists
func (s *ListService) CreateList(ctx context.Context, user *models.User, roomID, name, description string, icon string) (*models.List, error) {
    if err := s.ensureRoomMembership(ctx, user, roomID); err != nil { return nil, err }
    if name == "" { return nil, derr.ErrBadRequest }
    now := time.Now().UTC()
    l := &models.List{
        ListID:        ids.NewID("list"),
        RoomID:        roomID,
        Name:          name,
        Description:   description,
        DeletionVotes: map[string]string{},
        CreatedAt:     now,
        UpdatedAt:     now,
    }
    if icon != "" {
        if !models.IsValidListIcon(icon) { return nil, derr.ErrBadRequest }
        l.Icon = icon
    }
    if err := s.lists.Put(ctx, l); err != nil { return nil, err }
    return l, nil
}

func (s *ListService) ListLists(ctx context.Context, user *models.User, roomID string) ([]models.List, error) {
    if err := s.ensureRoomMembership(ctx, user, roomID); err != nil { return nil, err }
    return s.lists.ListByRoom(ctx, roomID)
}

func (s *ListService) VoteListDeletion(ctx context.Context, user *models.User, roomID, listID string) (bool, error) {
    if err := s.ensureRoomMembership(ctx, user, roomID); err != nil { return false, err }
    l, err := s.lists.GetByID(ctx, listID)
    if err != nil { return false, err }
    if l.RoomID != roomID { return false, derr.ErrForbidden }
    now := time.Now().UTC()
    if err := s.lists.AddDeletionVote(ctx, listID, user.UserID, now); err != nil { return false, err }
    // finalize when all room members have voted
    rm, err := s.rooms.GetByID(ctx, roomID)
    if err != nil { return false, err }
    return s.lists.FinalizeDeleteIfVotedByAll(ctx, listID, rm.MemberIDs, now)
}

func (s *ListService) CancelListDeletionVote(ctx context.Context, user *models.User, roomID, listID string) error {
    if err := s.ensureRoomMembership(ctx, user, roomID); err != nil { return err }
    l, err := s.lists.GetByID(ctx, listID)
    if err != nil { return err }
    if l.RoomID != roomID { return derr.ErrForbidden }
    return s.lists.RemoveDeletionVote(ctx, listID, user.UserID)
}

// UpdateList updates the list's name and/or description.
func (s *ListService) UpdateList(ctx context.Context, user *models.User, roomID, listID string, name *string, description *string, icon *string, notes *string) (*models.List, error) {
    if err := s.ensureRoomMembership(ctx, user, roomID); err != nil { return nil, err }
    l, err := s.lists.GetByID(ctx, listID)
    if err != nil { return nil, err }
    if l.RoomID != roomID || l.IsDeleted { return nil, derr.ErrForbidden }
    if name == nil && description == nil && icon == nil && notes == nil { return l, nil }
    now := time.Now().UTC()
    if name != nil {
        if *name == "" { return nil, derr.ErrBadRequest }
        if err := s.lists.UpdateName(ctx, listID, *name, now); err != nil { return nil, err }
    }
    if description != nil {
        if err := s.lists.UpdateDescription(ctx, listID, *description, now); err != nil { return nil, err }
    }
    if icon != nil {
        if *icon == "" {
            if err := s.lists.UpdateIcon(ctx, listID, "", now); err != nil { return nil, err }
        } else {
            if !models.IsValidListIcon(*icon) { return nil, derr.ErrBadRequest }
            if err := s.lists.UpdateIcon(ctx, listID, *icon, now); err != nil { return nil, err }
        }
    }
    if notes != nil {
        // Cap notes length to prevent abuse (64KB)
        if len(*notes) > 65535 { return nil, derr.ErrBadRequest }
        if err := s.lists.UpdateNotes(ctx, listID, *notes, now); err != nil { return nil, err }
    }
    return s.lists.GetByID(ctx, listID)
}

// Items
func (s *ListService) CreateItem(ctx context.Context, user *models.User, roomID, listID, description string) (*models.ListItem, error) {
    if err := s.ensureRoomMembership(ctx, user, roomID); err != nil { return nil, err }
    l, err := s.lists.GetByID(ctx, listID)
    if err != nil { return nil, err }
    if l.RoomID != roomID || l.IsDeleted { return nil, derr.ErrForbidden }
    now := time.Now().UTC()
    // Determine append order: use max existing order + 1000, or fallback to timestamp if empty
    items, err := s.items.ListByList(ctx, listID)
    if err != nil { return nil, err }
    var nextOrder float64 = float64(time.Now().UTC().UnixNano())
    if len(items) > 0 {
        max := items[0].Order
        for _, x := range items { if x.Order > max { max = x.Order } }
        if max > 0 { nextOrder = max + 1000 }
    }
    it := &models.ListItem{
        ItemID:      ids.NewID("item"),
        ListID:      listID,
        RoomID:      roomID,
        Order:       nextOrder,
        Description: description,
        Completed:   false,
        CreatedAt:   now,
        UpdatedAt:   now,
    }
    if err := s.items.Put(ctx, it); err != nil { return nil, err }
    return it, nil
}

func (s *ListService) ListItems(ctx context.Context, user *models.User, roomID, listID string, includeCompleted bool) ([]models.ListItem, error) {
    if err := s.ensureRoomMembership(ctx, user, roomID); err != nil { return nil, err }
    l, err := s.lists.GetByID(ctx, listID)
    if err != nil { return nil, err }
    if l.RoomID != roomID || l.IsDeleted { return nil, derr.ErrForbidden }
    items, err := s.items.ListByList(ctx, listID)
    if err != nil { return nil, err }
    if includeCompleted { return items, nil }
    out := make([]models.ListItem, 0, len(items))
    for _, it := range items { if !it.Completed { out = append(out, it) } }
    return out, nil
}

func (s *ListService) UpdateItem(ctx context.Context, user *models.User, roomID, listID, itemID string, description *string, completed *bool) (*models.ListItem, error) {
    if err := s.ensureRoomMembership(ctx, user, roomID); err != nil { return nil, err }
    it, err := s.items.GetByID(ctx, itemID)
    if err != nil { return nil, err }
    if it.RoomID != roomID || it.ListID != listID { return nil, derr.ErrForbidden }
    now := time.Now().UTC()
    if description != nil {
        if err := s.items.UpdateDescription(ctx, itemID, *description, now); err != nil { return nil, err }
    }
    if completed != nil {
        if err := s.items.UpdateCompletion(ctx, itemID, *completed, now); err != nil { return nil, err }
    }
    // return latest
    return s.items.GetByID(ctx, itemID)
}

func (s *ListService) DeleteItem(ctx context.Context, user *models.User, roomID, listID, itemID string) error {
    if err := s.ensureRoomMembership(ctx, user, roomID); err != nil { return err }
    it, err := s.items.GetByID(ctx, itemID)
    if err != nil { return err }
    if it.RoomID != roomID || it.ListID != listID { return derr.ErrForbidden }
    return s.items.Delete(ctx, itemID)
}

// UpdateItemPosition repositions an item between prev and next neighbors.
// If there is insufficient gap, it compacts orders then inserts at midpoint.
func (s *ListService) UpdateItemPosition(ctx context.Context, user *models.User, roomID, listID, itemID string, prevID *string, nextID *string) (*models.ListItem, error) {
    if err := s.ensureRoomMembership(ctx, user, roomID); err != nil { return nil, err }
    it, err := s.items.GetByID(ctx, itemID)
    if err != nil { return nil, err }
    if it.RoomID != roomID || it.ListID != listID { return nil, derr.ErrForbidden }
    items, err := s.items.ListByList(ctx, listID)
    if err != nil { return nil, err }
    // Map by ID
    var prevOrder, nextOrder *float64
    for i := range items {
        if prevID != nil && items[i].ItemID == *prevID { v := items[i].Order; prevOrder = &v }
        if nextID != nil && items[i].ItemID == *nextID { v := items[i].Order; nextOrder = &v }
    }
    now := time.Now().UTC()
    chooseAfter := func() float64 {
        // place after last
        max := 0.0
        for _, x := range items { if x.Order > max { max = x.Order } }
        if max == 0 { return float64(now.UnixNano()) }
        return max + 1000
    }
    const epsilon = 0.0000001
    var newOrder float64
    switch {
    case prevOrder != nil && nextOrder != nil:
        gap := *nextOrder - *prevOrder
        if gap > epsilon {
            newOrder = *prevOrder + gap/2
        } else {
            // compact then recompute
            step := 1000.0
            cur := step
            for _, x := range items {
                if err := s.items.UpdateOrder(ctx, x.ItemID, cur, now); err != nil { return nil, err }
                if prevID != nil && x.ItemID == *prevID { p := cur; prevOrder = &p }
                if nextID != nil && x.ItemID == *nextID { n := cur; nextOrder = &n }
                cur += step
            }
            newOrder = *prevOrder + (*nextOrder-*prevOrder)/2
        }
    case prevOrder != nil:
        newOrder = *prevOrder + 1000
    case nextOrder != nil:
        newOrder = *nextOrder - 1000
    default:
        newOrder = chooseAfter()
    }
    if err := s.items.UpdateOrder(ctx, itemID, newOrder, now); err != nil { return nil, err }
    return s.items.GetByID(ctx, itemID)
}
