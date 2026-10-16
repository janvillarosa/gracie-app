package services

import (
	"context"
	"sort"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/parse"
	"github.com/janvillarosa/gracie-app/backend/internal/services/categorization"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
	"github.com/janvillarosa/gracie-app/backend/pkg/ids"
)

type ListService struct {
	users       store.UserRepository
	rooms       store.RoomRepository
	lists       store.ListRepository
	items       store.ListItemRepository
	categorizer categorization.Categorizer
	emitter
}

func NewListService(users store.UserRepository, rooms store.RoomRepository, lists store.ListRepository, items store.ListItemRepository, categorizer categorization.Categorizer) *ListService {
	return &ListService{users: users, rooms: rooms, lists: lists, items: items, categorizer: categorizer}
}

func (s *ListService) ensureRoomMembership(ctx context.Context, user *models.User, roomID string) error {
	return ensureRoomMembership(ctx, s.rooms, user, roomID)
}

// Lists
func (s *ListService) CreateList(ctx context.Context, user *models.User, roomID, name, description string, icon string) (*models.List, error) {
	if err := s.ensureRoomMembership(ctx, user, roomID); err != nil {
		return nil, err
	}
	if name == "" {
		return nil, derr.ErrBadRequest
	}
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
		if !models.IsValidListIcon(icon) {
			return nil, derr.ErrBadRequest
		}
		l.Icon = icon
	}
	if err := s.lists.Put(ctx, l); err != nil {
		return nil, err
	}
	s.emitList(ctx, "list.created", user, roomID, l.ListID, nil)
	return l, nil
}

func (s *ListService) ListLists(ctx context.Context, user *models.User, roomID string) ([]models.List, error) {
	if err := s.ensureRoomMembership(ctx, user, roomID); err != nil {
		return nil, err
	}
	return s.lists.ListByRoom(ctx, roomID)
}

func (s *ListService) VoteListDeletion(ctx context.Context, user *models.User, roomID, listID string) (bool, error) {
	if err := s.ensureRoomMembership(ctx, user, roomID); err != nil {
		return false, err
	}
	l, err := s.lists.GetByID(ctx, listID)
	if err != nil {
		return false, err
	}
	if l.RoomID != roomID {
		return false, derr.ErrForbidden
	}
	now := time.Now().UTC()
	if err := s.lists.AddDeletionVote(ctx, listID, user.UserID, now); err != nil {
		return false, err
	}
	// finalize when all room members have voted
	rm, err := s.rooms.GetByID(ctx, roomID)
	if err != nil {
		return false, err
	}
	deleted, err := s.lists.FinalizeDeleteIfVotedByAll(ctx, listID, rm.MemberIDs, now)
	if err != nil {
		return false, err
	}
	s.emitList(ctx, "list.delete_voted", user, roomID, listID, nil)
	if deleted {
		s.emitList(ctx, "list.deleted", user, roomID, listID, nil)
	}
	return deleted, nil
}

func (s *ListService) CancelListDeletionVote(ctx context.Context, user *models.User, roomID, listID string) error {
	if err := s.ensureRoomMembership(ctx, user, roomID); err != nil {
		return err
	}
	l, err := s.lists.GetByID(ctx, listID)
	if err != nil {
		return err
	}
	if l.RoomID != roomID {
		return derr.ErrForbidden
	}
	if err := s.lists.RemoveDeletionVote(ctx, listID, user.UserID); err != nil {
		return err
	}
	s.emitList(ctx, "list.delete_vote_cancelled", user, roomID, listID, nil)
	return nil
}

// UpdateList updates the list's name and/or description.
func (s *ListService) UpdateList(ctx context.Context, user *models.User, roomID, listID string, name *string, description *string, icon *string, notes *string) (*models.List, error) {
	if err := s.ensureRoomMembership(ctx, user, roomID); err != nil {
		return nil, err
	}
	l, err := s.lists.GetByID(ctx, listID)
	if err != nil {
		return nil, err
	}
	if l.RoomID != roomID || l.IsDeleted {
		return nil, derr.ErrForbidden
	}
	if name == nil && description == nil && icon == nil && notes == nil {
		return l, nil
	}
	now := time.Now().UTC()
	var changed []string
	if name != nil {
		changed = append(changed, "name")
		if *name == "" {
			return nil, derr.ErrBadRequest
		}
		if err := s.lists.UpdateName(ctx, listID, *name, now); err != nil {
			return nil, err
		}
	}
	if description != nil {
		changed = append(changed, "description")
		if err := s.lists.UpdateDescription(ctx, listID, *description, now); err != nil {
			return nil, err
		}
	}
	if icon != nil {
		changed = append(changed, "icon")
		if *icon == "" {
			if err := s.lists.UpdateIcon(ctx, listID, "", now); err != nil {
				return nil, err
			}
		} else {
			if !models.IsValidListIcon(*icon) {
				return nil, derr.ErrBadRequest
			}
			if err := s.lists.UpdateIcon(ctx, listID, *icon, now); err != nil {
				return nil, err
			}
		}
	}
	if notes != nil {
		changed = append(changed, "notes")
		// Cap notes length to prevent abuse (64KB)
		if len(*notes) > 65535 {
			return nil, derr.ErrBadRequest
		}
		if err := s.lists.UpdateNotes(ctx, listID, *notes, now); err != nil {
			return nil, err
		}
	}
	s.emitList(ctx, "list.updated", user, roomID, listID, fieldsProp(changed))
	return s.lists.GetByID(ctx, listID)
}

// Items
func (s *ListService) CreateItem(ctx context.Context, user *models.User, roomID, listID, description string, quantity string, unit string, category string) (*models.ListItem, error) {
	if err := s.ensureRoomMembership(ctx, user, roomID); err != nil {
		return nil, err
	}
	l, err := s.lists.GetByID(ctx, listID)
	if err != nil {
		return nil, err
	}
	if l.RoomID != roomID || l.IsDeleted {
		return nil, derr.ErrForbidden
	}
	now := time.Now().UTC()
	// Determine append order: use max existing order + 1000, or fallback to timestamp if empty
	items, err := s.items.ListByList(ctx, listID)
	if err != nil {
		return nil, err
	}
	nextOrder := float64(time.Now().UTC().UnixNano())
	if len(items) > 0 {
		max := items[0].Order
		for _, x := range items {
			if x.Order > max {
				max = x.Order
			}
		}
		if max > 0 {
			nextOrder = max + 1000
		}
	}
	it := &models.ListItem{
		ItemID:      ids.NewID("item"),
		ListID:      listID,
		RoomID:      roomID,
		Order:       nextOrder,
		Description: description,
		Quantity:    quantity,
		Unit:        unit,
		Category:    category,
		Completed:   false,
		CreatedBy:   user.UserID,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	// Auto-categorize if not provided. Errors degrade to General rather than
	// failing item creation.
	if it.Category == "" {
		cat, _, err := s.categorizer.Categorize(ctx, description)
		if err != nil || cat == "" {
			cat = categorization.General
		}
		it.Category = cat
	}
	if err := s.items.Put(ctx, it); err != nil {
		return nil, err
	}
	s.emitItem(ctx, "item.added", user, it)
	return it, nil
}

// normalizeItemForRead splits a legacy item whose quantity/unit is still baked
// into the description. Only rewrites the returned copy — never touches the DB.
// Skipped when Quantity is already populated (no double-strip).
func normalizeItemForRead(it models.ListItem) models.ListItem {
	if it.Quantity != "" {
		return it
	}
	desc, qty, unit := parse.ParseInput(it.Description)
	if qty == "" {
		return it
	}
	it.Description = desc
	it.Quantity = qty
	it.Unit = unit
	return it
}

func (s *ListService) ListItems(ctx context.Context, user *models.User, roomID, listID string, includeCompleted bool) ([]models.ListItem, error) {
	if err := s.ensureRoomMembership(ctx, user, roomID); err != nil {
		return nil, err
	}
	l, err := s.lists.GetByID(ctx, listID)
	if err != nil {
		return nil, err
	}
	if l.RoomID != roomID || l.IsDeleted {
		return nil, derr.ErrForbidden
	}
	items, err := s.items.ListByList(ctx, listID)
	if err != nil {
		return nil, err
	}

	out := make([]models.ListItem, 0, len(items))
	for _, it := range items {
		if it.IsArchived {
			continue
		}
		if !includeCompleted && it.Completed {
			continue
		}
		out = append(out, normalizeItemForRead(it))
	}
	return out, nil
}

func (s *ListService) UpdateItem(ctx context.Context, user *models.User, roomID, listID, itemID string, description *string, completed *bool, quantity *string, unit *string, category *string, starred *bool) (*models.ListItem, error) {
	if err := s.ensureRoomMembership(ctx, user, roomID); err != nil {
		return nil, err
	}
	it, err := s.items.GetByID(ctx, itemID)
	if err != nil {
		return nil, err
	}
	if it.RoomID != roomID || it.ListID != listID {
		return nil, derr.ErrForbidden
	}
	now := time.Now().UTC()
	wasStarred := it.IsStarred
	var edited []string
	if description != nil {
		edited = append(edited, "description")
		if err := s.items.UpdateDescription(ctx, itemID, *description, now); err != nil {
			return nil, err
		}
	}
	if completed != nil {
		if err := s.items.UpdateCompletion(ctx, itemID, *completed, user.UserID, now); err != nil {
			return nil, err
		}
	}
	if quantity != nil {
		edited = append(edited, "quantity")
		if err := s.items.UpdateQuantity(ctx, itemID, *quantity, now); err != nil {
			return nil, err
		}
	}
	if unit != nil {
		edited = append(edited, "unit")
		if err := s.items.UpdateUnit(ctx, itemID, *unit, now); err != nil {
			return nil, err
		}
	}
	if category != nil {
		edited = append(edited, "category")
		if err := s.items.UpdateCategory(ctx, itemID, *category, now); err != nil {
			return nil, err
		}
	}
	if starred != nil {
		if err := s.items.UpdateStarred(ctx, itemID, *starred, now); err != nil {
			return nil, err
		}
	}
	latest, err := s.items.GetByID(ctx, itemID)
	if err != nil {
		return nil, err
	}
	// Only a real state change is a behavior event: re-sending the same value is not.
	if completed != nil && *completed != it.Completed {
		name := "item.unchecked"
		if *completed {
			name = "item.checked"
		}
		s.emitItem(ctx, name, user, latest)
	}
	if starred != nil && *starred != wasStarred {
		name := "item.unstarred"
		if *starred {
			name = "item.starred"
		}
		s.emitItem(ctx, name, user, latest)
	}
	if len(edited) > 0 {
		s.emit(ctx, analytics.Event{
			Name: "item.edited", ActorID: user.UserID, RoomID: roomID,
			Subject: analytics.Ref{Type: "item", ID: itemID}, Container: ref(listRef(listID)),
			Key: parse.NormalizeKey(latest.Description), Category: latest.Category, Props: fieldsProp(edited),
		})
	}
	return latest, nil
}

func (s *ListService) ArchiveCompletedItems(ctx context.Context, user *models.User, roomID, listID string) error {
	if err := s.ensureRoomMembership(ctx, user, roomID); err != nil {
		return err
	}
	l, err := s.lists.GetByID(ctx, listID)
	if err != nil {
		return err
	}
	if l.RoomID != roomID || l.IsDeleted {
		return derr.ErrForbidden
	}
	now := time.Now().UTC()
	n, err := s.items.ArchiveCompletedByList(ctx, listID, now)
	if err != nil {
		return err
	}
	if n > 0 {
		s.emitList(ctx, "list.cleared", user, roomID, listID, map[string]any{"count": n})
	}
	return nil
}

// PantryItem is one distinct thing a house has bought before; it powers add-bar
// suggestions. Common entries come from the built-in grocery set, not house history.
type PantryItem struct {
	Description string    `json:"description"`
	Category    string    `json:"category"`
	Quantity    string    `json:"quantity"`
	Unit        string    `json:"unit"`
	TimesAdded  int       `json:"times_added"`
	LastAddedAt time.Time `json:"last_added_at"`
	Common      bool      `json:"common"`
}

// A house with fewer distinct items than this also gets the common grocery set.
const pantrySeedThreshold = 60

// pantryByKey groups items (newest first, as ListByRoom returns them) by normalized key, so
// the first sighting of a key carries its most recent description, category, quantity and
// unit. order lists keys in first-seen order.
func pantryByKey(items []models.ListItem) (byKey map[string]*PantryItem, order []string) {
	byKey = make(map[string]*PantryItem)
	for _, it := range items {
		key := parse.NormalizeKey(it.Description)
		if key == "" {
			continue
		}
		if p, ok := byKey[key]; ok {
			p.TimesAdded++
			continue
		}
		byKey[key] = &PantryItem{
			Description: it.Description,
			Category:    it.Category,
			Quantity:    it.Quantity,
			Unit:        it.Unit,
			TimesAdded:  1,
			LastAddedAt: it.CreatedAt,
		}
		order = append(order, key)
	}
	return byKey, order
}

func (s *ListService) GetPantry(ctx context.Context, user *models.User, roomID string) ([]PantryItem, error) {
	if err := s.ensureRoomMembership(ctx, user, roomID); err != nil {
		return nil, err
	}
	items, err := s.items.ListByRoom(ctx, roomID)
	if err != nil {
		return nil, err
	}

	byKey, order := pantryByKey(items)

	out := make([]PantryItem, 0, len(order))
	for _, k := range order {
		out = append(out, *byKey[k])
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].TimesAdded != out[j].TimesAdded {
			return out[i].TimesAdded > out[j].TimesAdded
		}
		return out[i].LastAddedAt.After(out[j].LastAddedAt)
	})

	if len(out) < pantrySeedThreshold {
		for _, a := range categorization.GroceryAnchors {
			if _, ok := byKey[a.Term]; ok {
				continue
			}
			out = append(out, PantryItem{
				Description: capitalizeFirst(a.Term),
				Category:    a.Category,
				Common:      true,
			})
		}
	}
	return out, nil
}

func capitalizeFirst(s string) string {
	if s == "" {
		return s
	}
	r, n := utf8.DecodeRuneInString(s)
	return string(unicode.ToUpper(r)) + s[n:]
}

func (s *ListService) DeleteItem(ctx context.Context, user *models.User, roomID, listID, itemID string) error {
	if err := s.ensureRoomMembership(ctx, user, roomID); err != nil {
		return err
	}
	it, err := s.items.GetByID(ctx, itemID)
	if err != nil {
		return err
	}
	if it.RoomID != roomID || it.ListID != listID {
		return derr.ErrForbidden
	}
	if err := s.items.Delete(ctx, itemID); err != nil {
		return err
	}
	s.emitItem(ctx, "item.deleted", user, it)
	return nil
}

// UpdateItemPosition repositions an item between prev and next neighbors.
// If there is insufficient gap, it compacts orders then inserts at midpoint.
func (s *ListService) UpdateItemPosition(ctx context.Context, user *models.User, roomID, listID, itemID string, prevID *string, nextID *string) (*models.ListItem, error) {
	if err := s.ensureRoomMembership(ctx, user, roomID); err != nil {
		return nil, err
	}
	it, err := s.items.GetByID(ctx, itemID)
	if err != nil {
		return nil, err
	}
	if it.RoomID != roomID || it.ListID != listID {
		return nil, derr.ErrForbidden
	}
	items, err := s.items.ListByList(ctx, listID)
	if err != nil {
		return nil, err
	}
	// Map by ID
	var prevOrder, nextOrder *float64
	for i := range items {
		if prevID != nil && items[i].ItemID == *prevID {
			v := items[i].Order
			prevOrder = &v
		}
		if nextID != nil && items[i].ItemID == *nextID {
			v := items[i].Order
			nextOrder = &v
		}
	}
	now := time.Now().UTC()
	chooseAfter := func() float64 {
		// place after last
		max := 0.0
		for _, x := range items {
			if x.Order > max {
				max = x.Order
			}
		}
		if max == 0 {
			return float64(now.UnixNano())
		}
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
				if err := s.items.UpdateOrder(ctx, x.ItemID, cur, now); err != nil {
					return nil, err
				}
				if prevID != nil && x.ItemID == *prevID {
					p := cur
					prevOrder = &p
				}
				if nextID != nil && x.ItemID == *nextID {
					n := cur
					nextOrder = &n
				}
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
	if err := s.items.UpdateOrder(ctx, itemID, newOrder, now); err != nil {
		return nil, err
	}
	s.emitItem(ctx, "item.reordered", user, it)
	return s.items.GetByID(ctx, itemID)
}

func listRef(listID string) analytics.Ref { return analytics.Ref{Type: "list", ID: listID} }

func (s *ListService) emitList(ctx context.Context, name string, user *models.User, roomID, listID string, props map[string]any) {
	s.emit(ctx, analytics.Event{Name: name, ActorID: user.UserID, RoomID: roomID, Subject: listRef(listID), Props: props})
}

// emitItem builds an item event: the container is its list and Key is the
// normalized text (never the raw text).
func (s *ListService) emitItem(ctx context.Context, name string, user *models.User, it *models.ListItem) {
	var props map[string]any
	if name == "item.added" {
		if src := addSourceFrom(ctx); src != "" {
			props = map[string]any{"source": src}
		}
	}
	s.emit(ctx, analytics.Event{
		Name: name, ActorID: user.UserID, RoomID: it.RoomID,
		Subject: analytics.Ref{Type: "item", ID: it.ItemID}, Container: ref(listRef(it.ListID)),
		Key: parse.NormalizeKey(it.Description), Category: it.Category, Props: props,
	})
}
