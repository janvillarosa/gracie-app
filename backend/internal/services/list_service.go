package services

import (
	"context"
	"strings"
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
	if user.RoomID == nil || *user.RoomID == "" {
		return derr.ErrForbidden
	}
	if *user.RoomID != roomID {
		return derr.ErrForbidden
	}
	rm, err := s.rooms.GetByID(ctx, roomID)
	if err != nil {
		return err
	}
	// verify membership
	isMember := false
	for _, mid := range rm.MemberIDs {
		if mid == user.UserID {
			isMember = true
			break
		}
	}
	if !isMember {
		return derr.ErrForbidden
	}
	return nil
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
	return s.lists.FinalizeDeleteIfVotedByAll(ctx, listID, rm.MemberIDs, now)
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
	return s.lists.RemoveDeletionVote(ctx, listID, user.UserID)
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
	if name != nil {
		if *name == "" {
			return nil, derr.ErrBadRequest
		}
		if err := s.lists.UpdateName(ctx, listID, *name, now); err != nil {
			return nil, err
		}
	}
	if description != nil {
		if err := s.lists.UpdateDescription(ctx, listID, *description, now); err != nil {
			return nil, err
		}
	}
	if icon != nil {
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
		// Cap notes length to prevent abuse (64KB)
		if len(*notes) > 65535 {
			return nil, derr.ErrBadRequest
		}
		if err := s.lists.UpdateNotes(ctx, listID, *notes, now); err != nil {
			return nil, err
		}
	}
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
	var nextOrder float64 = float64(time.Now().UTC().UnixNano())
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
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	// Auto-categorize if not provided
	if it.Category == "" {
		it.Category = s.autoCategorize(description)
	}
	if err := s.items.Put(ctx, it); err != nil {
		return nil, err
	}
	return it, nil
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
		out = append(out, it)
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
	if description != nil {
		if err := s.items.UpdateDescription(ctx, itemID, *description, now); err != nil {
			return nil, err
		}
	}
	if completed != nil {
		if err := s.items.UpdateCompletion(ctx, itemID, *completed, now); err != nil {
			return nil, err
		}
	}
	if quantity != nil {
		if err := s.items.UpdateQuantity(ctx, itemID, *quantity, now); err != nil {
			return nil, err
		}
	}
	if unit != nil {
		if err := s.items.UpdateUnit(ctx, itemID, *unit, now); err != nil {
			return nil, err
		}
	}
	if category != nil {
		if err := s.items.UpdateCategory(ctx, itemID, *category, now); err != nil {
			return nil, err
		}
	}
	if starred != nil {
		if err := s.items.UpdateStarred(ctx, itemID, *starred, now); err != nil {
			return nil, err
		}
	}
	// return latest
	return s.items.GetByID(ctx, itemID)
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
	return s.items.ArchiveCompletedByList(ctx, listID, now)
}

type PantryItem struct {
	Description string `json:"description"`
	Category    string `json:"category"`
	Unit        string `json:"unit"`
}

func (s *ListService) GetPantry(ctx context.Context, user *models.User, roomID string) ([]PantryItem, error) {
	if err := s.ensureRoomMembership(ctx, user, roomID); err != nil {
		return nil, err
	}
	items, err := s.items.ListArchivedByRoom(ctx, roomID)
	if err != nil {
		return nil, err
	}

	// Aggregate unique items by description
	seen := make(map[string]PantryItem)
	for _, it := range items {
		desc := it.Description
		if _, ok := seen[desc]; !ok {
			seen[desc] = PantryItem{
				Description: desc,
				Category:    it.Category,
				Unit:        it.Unit,
			}
		}
	}

	out := make([]PantryItem, 0, len(seen))
	for _, v := range seen {
		out = append(out, v)
	}
	return out, nil
}

func (s *ListService) autoCategorize(desc string) string {
	type rule struct {
		k string
		v string
	}
	// Ordered slice for prioritized matching (longest phrases first)
	rules := []rule{
		// Household & Personal (Specific exceptions first)
		{k: "shaving cream", v: "Household"}, {k: "shaving", v: "Household"},
		{k: "toilet paper", v: "Household"}, {k: "kitchen roll", v: "Household"},
		{k: "paper towel", v: "Household"}, {k: "trash bag", v: "Household"},
		{k: "garbage bag", v: "Household"}, {k: "bin bag", v: "Household"},

		// Frozen
		{k: "frozen pizza", v: "Frozen"}, {k: "ice cream", v: "Frozen"},
		{k: "sorbet", v: "Frozen"}, {k: "gelato", v: "Frozen"},
		{k: "frozen peas", v: "Frozen"}, {k: "frozen berries", v: "Frozen"},
		{k: "frozen fruit", v: "Frozen"}, {k: "frozen veg", v: "Frozen"},
		{k: "frozen corn", v: "Frozen"}, {k: "chicken nugget", v: "Frozen"},
		{k: "fish finger", v: "Frozen"}, {k: "fish stick", v: "Frozen"},
		{k: "tater tot", v: "Frozen"}, {k: "hash brown", v: "Frozen"},
		{k: "waffle", v: "Frozen"}, {k: "frozen", v: "Frozen"},

		// Eggs & Dairy & Alternatives
		{k: "oat milk", v: "Eggs & Dairy"}, {k: "almond milk", v: "Eggs & Dairy"},
		{k: "soy milk", v: "Eggs & Dairy"}, {k: "coconut milk", v: "Eggs & Dairy"},
		{k: "sour cream", v: "Eggs & Dairy"}, {k: "heavy cream", v: "Eggs & Dairy"},
		{k: "whipping cream", v: "Eggs & Dairy"}, {k: "double cream", v: "Eggs & Dairy"},
		{k: "creme fraiche", v: "Eggs & Dairy"}, {k: "cottage cheese", v: "Eggs & Dairy"},
		{k: "cream cheese", v: "Eggs & Dairy"}, {k: "mozzarella", v: "Eggs & Dairy"},
		{k: "cheddar", v: "Eggs & Dairy"}, {k: "parmesan", v: "Eggs & Dairy"},
		{k: "feta", v: "Eggs & Dairy"}, {k: "halloumi", v: "Eggs & Dairy"},
		{k: "ricotta", v: "Eggs & Dairy"}, {k: "mascarpone", v: "Eggs & Dairy"},
		{k: "milk", v: "Eggs & Dairy"}, {k: "cheese", v: "Eggs & Dairy"},
		{k: "butter", v: "Eggs & Dairy"}, {k: "margarine", v: "Eggs & Dairy"},
		{k: "yogurt", v: "Eggs & Dairy"}, {k: "jogurt", v: "Eggs & Dairy"},
		{k: "kefir", v: "Eggs & Dairy"}, {k: "cream", v: "Eggs & Dairy"},
		{k: "curd", v: "Eggs & Dairy"}, {k: "egg", v: "Eggs & Dairy"},

		// Produce (Vegetables & Herbs)
		{k: "tenderstem broccoli", v: "Produce"}, {k: "pak choi", v: "Produce"},
		{k: "bok choi", v: "Produce"}, {k: "mange tout", v: "Produce"},
		{k: "sugar snap", v: "Produce"}, {k: "baby corn", v: "Produce"},
		{k: "coriander", v: "Produce"}, {k: "cilantro", v: "Produce"},
		{k: "parsley", v: "Produce"}, {k: "basil", v: "Produce"},
		{k: "mint", v: "Produce"}, {k: "rosemary", v: "Produce"},
		{k: "thyme", v: "Produce"}, {k: "chives", v: "Produce"},
		{k: "dill", v: "Produce"}, {k: "sage", v: "Produce"},
		{k: "oregano", v: "Produce"}, {k: "tarragon", v: "Produce"},
		{k: "lemongrass", v: "Produce"}, {k: "ginger", v: "Produce"},
		{k: "turmeric", v: "Produce"}, {k: "chili", v: "Produce"},
		{k: "chilli", v: "Produce"}, {k: "jalapeno", v: "Produce"},
		{k: "sweet potato", v: "Produce"}, {k: "bell pepper", v: "Produce"},
		{k: "broccoli", v: "Produce"}, {k: "carrot", v: "Produce"},
		{k: "onion", v: "Produce"}, {k: "scallion", v: "Produce"},
		{k: "spring onion", v: "Produce"}, {k: "garlic", v: "Produce"},
		{k: "kale", v: "Produce"}, {k: "spinach", v: "Produce"},
		{k: "lettuce", v: "Produce"}, {k: "arugula", v: "Produce"},
		{k: "rocket", v: "Produce"}, {k: "cucumber", v: "Produce"},
		{k: "tomato", v: "Produce"}, {k: "pepper", v: "Produce"},
		{k: "potato", v: "Produce"}, {k: "mushroom", v: "Produce"},
		{k: "zucchini", v: "Produce"}, {k: "courgette", v: "Produce"},
		{k: "asparagus", v: "Produce"}, {k: "cabbage", v: "Produce"},
		{k: "cauliflower", v: "Produce"}, {k: "celery", v: "Produce"},
		{k: "eggplant", v: "Produce"}, {k: "aubergine", v: "Produce"},
		{k: "leek", v: "Produce"}, {k: "radish", v: "Produce"},
		{k: "pea", v: "Produce"}, {k: "bean", v: "Produce"},
		{k: "corn on the cob", v: "Produce"}, {k: "sweetcorn", v: "Produce"},

		// Produce (Fruits)
		{k: "pomegranate", v: "Produce"}, {k: "dragon fruit", v: "Produce"},
		{k: "passion fruit", v: "Produce"}, {k: "pineapple", v: "Produce"},
		{k: "coconut", v: "Produce"}, {k: "strawberry", v: "Produce"},
		{k: "blueberry", v: "Produce"}, {k: "raspberry", v: "Produce"},
		{k: "blackberry", v: "Produce"}, {k: "cranberry", v: "Produce"},
		{k: "cherry", v: "Produce"}, {k: "apricot", v: "Produce"},
		{k: "nectarine", v: "Produce"}, {k: "peach", v: "Produce"},
		{k: "plum", v: "Produce"}, {k: "fig", v: "Produce"},
		{k: "date", v: "Produce"}, {k: "papaya", v: "Produce"},
		{k: "guava", v: "Produce"}, {k: "lychee", v: "Produce"},
		{k: "mango", v: "Produce"}, {k: "kiwi", v: "Produce"},
		{k: "melon", v: "Produce"}, {k: "watermelon", v: "Produce"},
		{k: "cantaloupe", v: "Produce"}, {k: "honeydew", v: "Produce"},
		{k: "pear", v: "Produce"}, {k: "apple", v: "Produce"},
		{k: "banana", v: "Produce"}, {k: "lemon", v: "Produce"},
		{k: "lime", v: "Produce"}, {k: "grapefruit", v: "Produce"},
		{k: "orange", v: "Produce"}, {k: "tangerine", v: "Produce"},
		{k: "clementine", v: "Produce"}, {k: "satsuma", v: "Produce"},
		{k: "mandarin", v: "Produce"}, {k: "grape", v: "Produce"},
		{k: "berry", v: "Produce"}, {k: "avocado", v: "Produce"},

		// Plant-Based Protein
		{k: "plant-based", v: "Plant-Based"}, {k: "meat-free", v: "Plant-Based"},
		{k: "tofu", v: "Plant-Based"}, {k: "tempeh", v: "Plant-Based"},
		{k: "seitan", v: "Plant-Based"}, {k: "vegan", v: "Plant-Based"},
		{k: "beyond meat", v: "Plant-Based"}, {k: "impossible burger", v: "Plant-Based"},
		{k: "nutritional yeast", v: "Plant-Based"}, {k: "quorn", v: "Plant-Based"},
		{k: "hummus", v: "Plant-Based"}, {k: "falafel", v: "Plant-Based"},

		// Grains, Pasta & Bakery
		{k: "tagliatelle", v: "Grains & Bakery"}, {k: "fettuccine", v: "Grains & Bakery"},
		{k: "pappardelle", v: "Grains & Bakery"}, {k: "linguine", v: "Grains & Bakery"},
		{k: "spaghetti", v: "Grains & Bakery"}, {k: "bucatini", v: "Grains & Bakery"},
		{k: "vermicelli", v: "Grains & Bakery"}, {k: "capellini", v: "Grains & Bakery"},
		{k: "fusilli", v: "Grains & Bakery"}, {k: "penne", v: "Grains & Bakery"},
		{k: "rigatoni", v: "Grains & Bakery"}, {k: "tortellini", v: "Grains & Bakery"},
		{k: "ravioli", v: "Grains & Bakery"}, {k: "gnocchi", v: "Grains & Bakery"},
		{k: "farfalle", v: "Grains & Bakery"}, {k: "orecchiette", v: "Grains & Bakery"},
		{k: "macaroni", v: "Grains & Bakery"}, {k: "cannelloni", v: "Grains & Bakery"},
		{k: "lasagna", v: "Grains & Bakery"}, {k: "lasagne", v: "Grains & Bakery"},
		{k: "orzo", v: "Grains & Bakery"}, {k: "conchiglie", v: "Grains & Bakery"},
		{k: "rotelli", v: "Grains & Bakery"}, {k: "gemelli", v: "Grains & Bakery"},
		{k: "pasta", v: "Grains & Bakery"}, {k: "noodle", v: "Grains & Bakery"},
		{k: "rice", v: "Grains & Bakery"}, {k: "quinoa", v: "Grains & Bakery"},
		{k: "couscous", v: "Grains & Bakery"}, {k: "bulgur", v: "Grains & Bakery"},
		{k: "oat", v: "Grains & Bakery"}, {k: "porridge", v: "Grains & Bakery"},
		{k: "flour", v: "Grains & Bakery"}, {k: "bread", v: "Grains & Bakery"},
		{k: "sourdough", v: "Grains & Bakery"}, {k: "baguette", v: "Grains & Bakery"},
		{k: "ciabatta", v: "Grains & Bakery"}, {k: "bagel", v: "Grains & Bakery"},
		{k: "tortilla", v: "Grains & Bakery"}, {k: "pita", v: "Grains & Bakery"},
		{k: "naan", v: "Grains & Bakery"}, {k: "croissant", v: "Grains & Bakery"},
		{k: "muffin", v: "Grains & Bakery"}, {k: "crumpet", v: "Grains & Bakery"},
		{k: "cereal", v: "Grains & Bakery"}, {k: "granola", v: "Grains & Bakery"},
		{k: "muesli", v: "Grains & Bakery"},

		// Pantry & Spices
		{k: "black pepper", v: "Pantry"}, {k: "white pepper", v: "Pantry"},
		{k: "cayenne", v: "Pantry"}, {k: "paprika", v: "Pantry"},
		{k: "cinnamon", v: "Pantry"}, {k: "cumin", v: "Pantry"},
		{k: "coriander seeds", v: "Pantry"}, {k: "turmeric powder", v: "Pantry"},
		{k: "maple syrup", v: "Pantry"}, {k: "honey", v: "Pantry"},
		{k: "agave", v: "Pantry"}, {k: "soy sauce", v: "Pantry"},
		{k: "tamari", v: "Pantry"}, {k: "fish sauce", v: "Pantry"},
		{k: "olive oil", v: "Pantry"}, {k: "canola oil", v: "Pantry"},
		{k: "vegetable oil", v: "Pantry"}, {k: "coconut oil", v: "Pantry"},
		{k: "sesame oil", v: "Pantry"}, {k: "vinegar", v: "Pantry"},
		{k: "balsamic", v: "Pantry"}, {k: "apple cider vinegar", v: "Pantry"},
		{k: "ketchup", v: "Pantry"}, {k: "mayo", v: "Pantry"},
		{k: "mustard", v: "Pantry"}, {k: "hot sauce", v: "Pantry"},
		{k: "sriracha", v: "Pantry"}, {k: "pesto", v: "Pantry"},
		{k: "pasta sauce", v: "Pantry"}, {k: "tomato paste", v: "Pantry"},
		{k: "canned tomato", v: "Pantry"}, {k: "tinned tomato", v: "Pantry"},
		{k: "baked beans", v: "Pantry"}, {k: "chickpeas", v: "Pantry"},
		{k: "lentils", v: "Pantry"}, {k: "kidney beans", v: "Pantry"},
		{k: "tuna", v: "Pantry"}, {k: "sardines", v: "Pantry"},
		{k: "soup", v: "Pantry"}, {k: "stock cube", v: "Pantry"},
		{k: "bouillon", v: "Pantry"}, {k: "salt", v: "Pantry"},
		{k: "sugar", v: "Pantry"}, {k: "brown sugar", v: "Pantry"},
		{k: "icing sugar", v: "Pantry"}, {k: "baking powder", v: "Pantry"},
		{k: "baking soda", v: "Pantry"}, {k: "yeast", v: "Pantry"},
		{k: "peanut butter", v: "Pantry"}, {k: "almond butter", v: "Pantry"},
		{k: "nutella", v: "Pantry"}, {k: "jam", v: "Pantry"},
		{k: "marmalade", v: "Pantry"}, {k: "oil", v: "Pantry"},
		{k: "spice", v: "Pantry"}, {k: "sauce", v: "Pantry"},
		{k: "syrup", v: "Pantry"}, {k: "nut", v: "Pantry"},
		{k: "walnut", v: "Pantry"}, {k: "almond", v: "Pantry"},
		{k: "cashew", v: "Pantry"}, {k: "peanut", v: "Pantry"},
		{k: "seed", v: "Pantry"}, {k: "chia", v: "Pantry"},
		{k: "pumpkin seed", v: "Pantry"}, {k: "sunflower seed", v: "Pantry"},
		{k: "chips", v: "Pantry"}, {k: "crisps", v: "Pantry"},
		{k: "popcorn", v: "Pantry"}, {k: "pretzels", v: "Pantry"},
		{k: "crackers", v: "Pantry"}, {k: "biscuits", v: "Pantry"},
		{k: "cookies", v: "Pantry"}, {k: "chocolate", v: "Pantry"},
		{k: "candy", v: "Pantry"}, {k: "sweets", v: "Pantry"},

		// Meat & Seafood
		{k: "chicken breast", v: "Meat & Seafood"}, {k: "chicken thigh", v: "Meat & Seafood"},
		{k: "minced beef", v: "Meat & Seafood"}, {k: "ground beef", v: "Meat & Seafood"},
		{k: "steak", v: "Meat & Seafood"}, {k: "beef", v: "Meat & Seafood"},
		{k: "pork", v: "Meat & Seafood"}, {k: "bacon", v: "Meat & Seafood"},
		{k: "ham", v: "Meat & Seafood"}, {k: "sausage", v: "Meat & Seafood"},
		{k: "salami", v: "Meat & Seafood"}, {k: "pepperoni", v: "Meat & Seafood"},
		{k: "turkey", v: "Meat & Seafood"}, {k: "lamb", v: "Meat & Seafood"},
		{k: "duck", v: "Meat & Seafood"}, {k: "venison", v: "Meat & Seafood"},
		{k: "meatball", v: "Meat & Seafood"}, {k: "burger", v: "Meat & Seafood"},
		{k: "salmon", v: "Meat & Seafood"}, {k: "cod", v: "Meat & Seafood"},
		{k: "haddock", v: "Meat & Seafood"}, {k: "sea bass", v: "Meat & Seafood"},
		{k: "trout", v: "Meat & Seafood"}, {k: "shrimp", v: "Meat & Seafood"},
		{k: "prawn", v: "Meat & Seafood"}, {k: "crab", v: "Meat & Seafood"},
		{k: "lobster", v: "Meat & Seafood"}, {k: "mussels", v: "Meat & Seafood"},
		{k: "clams", v: "Meat & Seafood"}, {k: "scallops", v: "Meat & Seafood"},
		{k: "tuna steak", v: "Meat & Seafood"}, {k: "fish", v: "Meat & Seafood"},
		{k: "meat", v: "Meat & Seafood"},

		// Household & Personal (General terms)
		{k: "soap", v: "Household"}, {k: "hand wash", v: "Household"},
		{k: "shower gel", v: "Household"}, {k: "shampoo", v: "Household"},
		{k: "conditioner", v: "Household"}, {k: "toothpaste", v: "Household"},
		{k: "toothbrush", v: "Household"}, {k: "floss", v: "Household"},
		{k: "mouthwash", v: "Household"}, {k: "deodorant", v: "Household"},
		{k: "razor", v: "Household"}, {k: "laundry detergent", v: "Household"},
		{k: "fabric softener", v: "Household"}, {k: "dish soap", v: "Household"},
		{k: "dishwasher tablets", v: "Household"}, {k: "cleaning spray", v: "Household"},
		{k: "bleach", v: "Household"}, {k: "sponge", v: "Household"},
		{k: "scrubber", v: "Household"}, {k: "tissues", v: "Household"},
		{k: "napkins", v: "Household"}, {k: "foil", v: "Household"},
		{k: "cling film", v: "Household"}, {k: "plastic wrap", v: "Household"},
		{k: "baking paper", v: "Household"}, {k: "parchment paper", v: "Household"},
		{k: "cleaner", v: "Household"}, {k: "paste", v: "Household"},

		// Beverages
		{k: "coffee beans", v: "Beverages"}, {k: "ground coffee", v: "Beverages"},
		{k: "instant coffee", v: "Beverages"}, {k: "tea bags", v: "Beverages"},
		{k: "green tea", v: "Beverages"}, {k: "herbal tea", v: "Beverages"},
		{k: "orange juice", v: "Beverages"}, {k: "apple juice", v: "Beverages"},
		{k: "juice", v: "Beverages"}, {k: "soda", v: "Beverages"},
		{k: "pop", v: "Beverages"}, {k: "coke", v: "Beverages"},
		{k: "pepsi", v: "Beverages"}, {k: "lemonade", v: "Beverages"},
		{k: "sparkling water", v: "Beverages"}, {k: "tonic water", v: "Beverages"},
		{k: "mineral water", v: "Beverages"}, {k: "energy drink", v: "Beverages"},
		{k: "kombucha", v: "Beverages"}, {k: "smoothie", v: "Beverages"},
		{k: "wine", v: "Beverages"}, {k: "beer", v: "Beverages"},
		{k: "ale", v: "Beverages"}, {k: "lager", v: "Beverages"},
		{k: "cider", v: "Beverages"}, {k: "spirits", v: "Beverages"},
		{k: "vodka", v: "Beverages"}, {k: "gin", v: "Beverages"},
		{k: "whisky", v: "Beverages"}, {k: "rum", v: "Beverages"},
		{k: "water", v: "Beverages"}, {k: "coffee", v: "Beverages"},
		{k: "tea", v: "Beverages"}, {k: "drink", v: "Beverages"},
	}

	d := strings.ToLower(desc)
	for _, r := range rules {
		if strings.Contains(d, r.k) {
			return r.v
		}
	}
	return "General"
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
	return s.items.Delete(ctx, itemID)
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
	return s.items.GetByID(ctx, itemID)
}
