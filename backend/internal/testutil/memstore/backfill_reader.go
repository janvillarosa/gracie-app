package memstore

import (
	"context"
	"sort"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
)

// BackfillReader walks the in-memory Store in ID order, mirroring the Mongo reader.
type BackfillReader struct{ st *Store }

// NewBackfillReader reads from the same Store that Compose's repos write to.
func (r Repos) NewBackfillReader() *BackfillReader {
	return &BackfillReader{st: r.Users.(*UserRepo).st}
}

func sortedKeys[V any](m map[string]V) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return ks
}

func (r *BackfillReader) EachUser(_ context.Context, roomID string, fn func(models.User) error) error {
	r.st.mu.RLock()
	var out []models.User
	for _, id := range sortedKeys(r.st.users) {
		u := *r.st.users[id]
		if roomID != "" && (u.RoomID == nil || *u.RoomID != roomID) {
			continue
		}
		// Match the Mongo projection: credentials never reach the backfill.
		u.PasswordEnc, u.APIKeyHash, u.APIKeyLookup, u.APIKeyExpiresAt, u.Username, u.Name = "", "", "", nil, "", ""
		out = append(out, u)
	}
	r.st.mu.RUnlock()
	for _, u := range out {
		if err := fn(u); err != nil {
			return err
		}
	}
	return nil
}

func (r *BackfillReader) EachRoom(_ context.Context, roomID string, fn func(models.Room) error) error {
	r.st.mu.RLock()
	var out []models.Room
	for _, id := range sortedKeys(r.st.rooms) {
		if roomID == "" || id == roomID {
			out = append(out, *r.st.rooms[id])
		}
	}
	r.st.mu.RUnlock()
	for _, v := range out {
		if err := fn(v); err != nil {
			return err
		}
	}
	return nil
}

func (r *BackfillReader) EachList(_ context.Context, roomID string, fn func(models.List) error) error {
	r.st.mu.RLock()
	var out []models.List
	for _, id := range sortedKeys(r.st.lists) {
		if l := r.st.lists[id]; roomID == "" || l.RoomID == roomID {
			out = append(out, *l)
		}
	}
	r.st.mu.RUnlock()
	for _, v := range out {
		if err := fn(v); err != nil {
			return err
		}
	}
	return nil
}

func (r *BackfillReader) EachItem(_ context.Context, roomID string, fn func(models.ListItem) error) error {
	r.st.mu.RLock()
	var out []models.ListItem
	for _, id := range sortedKeys(r.st.items) {
		if it := r.st.items[id]; roomID == "" || it.RoomID == roomID {
			out = append(out, *it)
		}
	}
	r.st.mu.RUnlock()
	for _, v := range out {
		if err := fn(v); err != nil {
			return err
		}
	}
	return nil
}

func (r *BackfillReader) EachTrip(_ context.Context, roomID string, fn func(models.Trip) error) error {
	r.st.mu.RLock()
	var out []models.Trip
	for _, id := range sortedKeys(r.st.trips) {
		if t := r.st.trips[id]; roomID == "" || t.RoomID == roomID {
			out = append(out, *t.Clone())
		}
	}
	r.st.mu.RUnlock()
	for _, v := range out {
		if err := fn(v); err != nil {
			return err
		}
	}
	return nil
}

var _ store.BackfillReader = (*BackfillReader)(nil)
