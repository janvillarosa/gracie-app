package memstore

import (
    "context"
    "errors"
    "sort"
    "sync"
    "time"

    derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
    "github.com/janvillarosa/gracie-app/backend/internal/models"
    "github.com/janvillarosa/gracie-app/backend/internal/store"
)

// Store is a simple in-memory store implementing repositories for tests.
type Store struct {
    mu            sync.RWMutex
    users         map[string]*models.User
    byUsername    map[string]string // username -> userID
    byLookup      map[string]string // api_key_lookup -> userID
    rooms         map[string]*models.Room
    byShareToken  map[string]string // token -> roomID
    lists         map[string]*models.List
    items         map[string]*models.ListItem
}

func NewStore() *Store {
    return &Store{
        users:        map[string]*models.User{},
        byUsername:   map[string]string{},
        byLookup:     map[string]string{},
        rooms:        map[string]*models.Room{},
        byShareToken: map[string]string{},
        lists:        map[string]*models.List{},
        items:        map[string]*models.ListItem{},
    }
}

// Tx implements store.TxRunner.
type Tx struct{}

func (Tx) WithTransaction(ctx context.Context, fn func(ctx context.Context) error) error { return fn(ctx) }

// Compose returns in-memory repos + a no-op Tx runner.
func Compose() (tx store.TxRunner, users store.UserRepository, rooms store.RoomRepository, lists store.ListRepository, items store.ListItemRepository) {
    st := NewStore()
    return Tx{}, &UserRepo{st}, &RoomRepo{st}, &ListRepo{st}, &ListItemRepo{st}
}

// UserRepo
type UserRepo struct{ st *Store }

func (r *UserRepo) Put(_ context.Context, u *models.User) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    if _, ok := r.st.users[u.UserID]; ok { return errors.New("exists") }
    cp := *u
    r.st.users[u.UserID] = &cp
    if u.Username != "" { r.st.byUsername[u.Username] = u.UserID }
    if u.APIKeyLookup != "" { r.st.byLookup[u.APIKeyLookup] = u.UserID }
    return nil
}
func (r *UserRepo) GetByID(_ context.Context, id string) (*models.User, error) {
    r.st.mu.RLock(); defer r.st.mu.RUnlock()
    if u, ok := r.st.users[id]; ok { cp := *u; return &cp, nil }
    return nil, derr.ErrNotFound
}
func (r *UserRepo) GetByUsername(_ context.Context, username string) (*models.User, error) {
    r.st.mu.RLock(); defer r.st.mu.RUnlock()
    if id, ok := r.st.byUsername[username]; ok { cp := *r.st.users[id]; return &cp, nil }
    return nil, derr.ErrNotFound
}
func (r *UserRepo) GetByAPIKeyLookup(_ context.Context, lookup string) (*models.User, error) {
    r.st.mu.RLock(); defer r.st.mu.RUnlock()
    if id, ok := r.st.byLookup[lookup]; ok { cp := *r.st.users[id]; return &cp, nil }
    return nil, derr.ErrUnauthorized
}
func (r *UserRepo) SetAPIKey(_ context.Context, userID string, hash, lookup string, _ *time.Time, updatedAt time.Time) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    u, ok := r.st.users[userID]
    if !ok { return derr.ErrNotFound }
    u.APIKeyHash = hash
    if lookup != "" {
        if u.APIKeyLookup != "" { delete(r.st.byLookup, u.APIKeyLookup) }
        u.APIKeyLookup = lookup
        r.st.byLookup[lookup] = userID
    }
    u.UpdatedAt = updatedAt
    return nil
}
func (r *UserRepo) UpdateName(_ context.Context, userID string, name string, updatedAt time.Time) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    u, ok := r.st.users[userID]
    if !ok { return derr.ErrNotFound }
    u.Name = name
    u.UpdatedAt = updatedAt
    return nil
}
func (r *UserRepo) SetRoomID(_ context.Context, userID string, roomID *string, updatedAt time.Time) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    u, ok := r.st.users[userID]
    if !ok { return derr.ErrNotFound }
    u.RoomID = roomID
    u.UpdatedAt = updatedAt
    return nil
}
func (r *UserRepo) UpdateUsername(_ context.Context, userID string, username string, updatedAt time.Time) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    u, ok := r.st.users[userID]
    if !ok { return derr.ErrNotFound }
    if u.Username != "" { delete(r.st.byUsername, u.Username) }
    u.Username = username
    r.st.byUsername[username] = userID
    u.UpdatedAt = updatedAt
    return nil
}
func (r *UserRepo) UpdatePasswordEnc(_ context.Context, userID string, enc string, updatedAt time.Time) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    u, ok := r.st.users[userID]
    if !ok { return errors.New("not found") }
    u.PasswordEnc = enc
    u.UpdatedAt = updatedAt
    return nil
}
func (r *UserRepo) Delete(_ context.Context, userID string) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    u, ok := r.st.users[userID]
    if !ok { return errors.New("not found") }
    if u.Username != "" { delete(r.st.byUsername, u.Username) }
    if u.APIKeyLookup != "" { delete(r.st.byLookup, u.APIKeyLookup) }
    delete(r.st.users, userID)
    return nil
}

// RoomRepo
type RoomRepo struct{ st *Store }

func (r *RoomRepo) Put(_ context.Context, rm *models.Room) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    if _, ok := r.st.rooms[rm.RoomID]; ok { return errors.New("exists") }
    cp := *rm
    if cp.DeletionVotes == nil { cp.DeletionVotes = map[string]string{} }
    r.st.rooms[rm.RoomID] = &cp
    return nil
}
func (r *RoomRepo) GetByID(_ context.Context, id string) (*models.Room, error) {
    r.st.mu.RLock(); defer r.st.mu.RUnlock()
    if rm, ok := r.st.rooms[id]; ok { cp := *rm; return &cp, nil }
    return nil, derr.ErrNotFound
}
func (r *RoomRepo) GetByShareToken(_ context.Context, token string) (*models.Room, error) {
    r.st.mu.RLock(); defer r.st.mu.RUnlock()
    if id, ok := r.st.byShareToken[token]; ok { cp := *r.st.rooms[id]; return &cp, nil }
    return nil, derr.ErrNotFound
}
func (r *RoomRepo) SetShareToken(_ context.Context, roomID string, _ string, token string, updatedAt time.Time) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    rm, ok := r.st.rooms[roomID]
    if !ok { return derr.ErrNotFound }
    rm.ShareToken = &token
    rm.UpdatedAt = updatedAt
    r.st.byShareToken[token] = roomID
    return nil
}
func (r *RoomRepo) RemoveShareToken(_ context.Context, roomID string, updatedAt time.Time) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    rm, ok := r.st.rooms[roomID]
    if !ok { return derr.ErrNotFound }
    if rm.ShareToken != nil {
        delete(r.st.byShareToken, *rm.ShareToken)
        rm.ShareToken = nil
    }
    rm.UpdatedAt = updatedAt
    return nil
}
func (r *RoomRepo) UpdateDescription(_ context.Context, roomID string, _ string, description string, updatedAt time.Time) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    rm, ok := r.st.rooms[roomID]
    if !ok { return derr.ErrNotFound }
    rm.Description = description
    rm.UpdatedAt = updatedAt
    return nil
}
func (r *RoomRepo) UpdateDisplayName(_ context.Context, roomID string, _ string, displayName string, updatedAt time.Time) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    rm, ok := r.st.rooms[roomID]
    if !ok { return derr.ErrNotFound }
    rm.DisplayName = displayName
    rm.UpdatedAt = updatedAt
    return nil
}
func (r *RoomRepo) VoteDeletion(_ context.Context, roomID string, userID string, ts time.Time) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    rm, ok := r.st.rooms[roomID]
    if !ok { return errors.New("not found") }
    if rm.DeletionVotes == nil { rm.DeletionVotes = map[string]string{} }
    rm.DeletionVotes[userID] = ts.UTC().Format(time.RFC3339)
    rm.UpdatedAt = ts
    return nil
}
func (r *RoomRepo) RemoveDeletionVote(_ context.Context, roomID string, userID string) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    rm, ok := r.st.rooms[roomID]
    if !ok { return errors.New("not found") }
    if rm.DeletionVotes != nil { delete(rm.DeletionVotes, userID) }
    return nil
}
func (r *RoomRepo) Delete(_ context.Context, roomID string) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    delete(r.st.rooms, roomID)
    return nil
}
func (r *RoomRepo) AddMember(_ context.Context, roomID string, userID string, updatedAt time.Time) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    rm, ok := r.st.rooms[roomID]
    if !ok { return errors.New("not found") }
    for _, id := range rm.MemberIDs { if id == userID { return errors.New("conflict") } }
    rm.MemberIDs = append(rm.MemberIDs, userID)
    sort.Strings(rm.MemberIDs)
    rm.UpdatedAt = updatedAt
    return nil
}
func (r *RoomRepo) RemoveMember(_ context.Context, roomID string, userID string, updatedAt time.Time) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    rm, ok := r.st.rooms[roomID]
    if !ok { return errors.New("not found") }
    filtered := rm.MemberIDs[:0]
    for _, id := range rm.MemberIDs { if id != userID { filtered = append(filtered, id) } }
    rm.MemberIDs = filtered
    rm.UpdatedAt = updatedAt
    return nil
}

// ListRepo (minimal implementation for cleanup tests)
type ListRepo struct{ st *Store }

func (r *ListRepo) Put(_ context.Context, l *models.List) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    cp := *l
    r.st.lists[l.ListID] = &cp
    return nil
}
func (r *ListRepo) GetByID(_ context.Context, id string) (*models.List, error) {
    r.st.mu.RLock(); defer r.st.mu.RUnlock()
    if l, ok := r.st.lists[id]; ok { cp := *l; return &cp, nil }
    return nil, derr.ErrNotFound
}
func (r *ListRepo) ListByRoom(_ context.Context, roomID string) ([]models.List, error) {
    r.st.mu.RLock(); defer r.st.mu.RUnlock()
    out := []models.List{}
    for _, l := range r.st.lists {
        if l.RoomID == roomID { cp := *l; out = append(out, cp) }
    }
    return out, nil
}
func (r *ListRepo) UpdateName(_ context.Context, listID string, name string, updatedAt time.Time) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    l, ok := r.st.lists[listID]
    if !ok { return derr.ErrNotFound }
    l.Name = name
    l.UpdatedAt = updatedAt
    return nil
}
func (r *ListRepo) UpdateDescription(_ context.Context, listID string, description string, updatedAt time.Time) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    l, ok := r.st.lists[listID]
    if !ok { return derr.ErrNotFound }
    l.Description = description
    l.UpdatedAt = updatedAt
    return nil
}
func (r *ListRepo) UpdateIcon(_ context.Context, listID string, icon string, updatedAt time.Time) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    l, ok := r.st.lists[listID]
    if !ok { return errors.New("not found") }
    l.Icon = icon
    l.UpdatedAt = updatedAt
    return nil
}
func (r *ListRepo) AddDeletionVote(_ context.Context, listID string, userID string, ts time.Time) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    l, ok := r.st.lists[listID]
    if !ok { return errors.New("not found") }
    if l.DeletionVotes == nil { l.DeletionVotes = map[string]string{} }
    l.DeletionVotes[userID] = ts.UTC().Format(time.RFC3339)
    l.UpdatedAt = ts
    return nil
}
func (r *ListRepo) RemoveDeletionVote(_ context.Context, listID string, userID string) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    l, ok := r.st.lists[listID]
    if !ok { return errors.New("not found") }
    if l.DeletionVotes != nil { delete(l.DeletionVotes, userID) }
    return nil
}
func (r *ListRepo) FinalizeDeleteIfVotedByAll(_ context.Context, listID string, memberIDs []string, ts time.Time) (bool, error) {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    l, ok := r.st.lists[listID]
    if !ok { return false, derr.ErrNotFound }
    for _, id := range memberIDs {
        if l.DeletionVotes[id] == "" { return false, nil }
    }
    delete(r.st.lists, listID)
    return true, nil
}
func (r *ListRepo) Delete(_ context.Context, listID string) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    delete(r.st.lists, listID)
    return nil
}

// ListItemRepo (minimal)
type ListItemRepo struct{ st *Store }

func (r *ListItemRepo) Put(_ context.Context, it *models.ListItem) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    cp := *it
    r.st.items[it.ItemID] = &cp
    return nil
}
func (r *ListItemRepo) GetByID(_ context.Context, id string) (*models.ListItem, error) {
    r.st.mu.RLock(); defer r.st.mu.RUnlock()
    if it, ok := r.st.items[id]; ok { cp := *it; return &cp, nil }
    return nil, derr.ErrNotFound
}
func (r *ListItemRepo) ListByList(_ context.Context, listID string) ([]models.ListItem, error) {
    r.st.mu.RLock(); defer r.st.mu.RUnlock()
    out := []models.ListItem{}
    for _, it := range r.st.items { if it.ListID == listID { cp := *it; out = append(out, cp) } }
    // Sort by Order ascending, then CreatedAt as fallback
    sort.SliceStable(out, func(i, j int) bool {
        oi, oj := out[i].Order, out[j].Order
        if oi == 0 && oj == 0 { return out[i].CreatedAt.Before(out[j].CreatedAt) }
        if oi == oj { return out[i].CreatedAt.Before(out[j].CreatedAt) }
        return oi < oj
    })
    return out, nil
}
func (r *ListItemRepo) UpdateCompletion(_ context.Context, itemID string, completed bool, updatedAt time.Time) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    it, ok := r.st.items[itemID]
    if !ok { return derr.ErrNotFound }
    it.Completed = completed
    it.UpdatedAt = updatedAt
    return nil
}
func (r *ListItemRepo) UpdateDescription(_ context.Context, itemID string, description string, updatedAt time.Time) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    it, ok := r.st.items[itemID]
    if !ok { return derr.ErrNotFound }
    it.Description = description
    it.UpdatedAt = updatedAt
    return nil
}
func (r *ListItemRepo) UpdateOrder(_ context.Context, itemID string, order float64, updatedAt time.Time) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    it, ok := r.st.items[itemID]
    if !ok { return derr.ErrNotFound }
    it.Order = order
    it.UpdatedAt = updatedAt
    return nil
}
func (r *ListItemRepo) Delete(_ context.Context, itemID string) error {
    r.st.mu.Lock(); defer r.st.mu.Unlock()
    delete(r.st.items, itemID)
    return nil
}
