package categorization

import (
	"context"
	"sync/atomic"
)

// Swappable is a Categorizer whose implementation can be replaced while it serves.
// The server starts with a cheap keyword chain so it can listen at once, then swaps
// in the embedding chain once the model and anchors are ready.
type Swappable struct {
	cur atomic.Pointer[Categorizer]
}

func NewSwappable(initial Categorizer) *Swappable {
	s := &Swappable{}
	s.Swap(initial)
	return s
}

// Swap replaces the categorizer used by later calls.
func (s *Swappable) Swap(c Categorizer) { s.cur.Store(&c) }

func (s *Swappable) Categorize(ctx context.Context, description string) (string, float64, error) {
	return (*s.cur.Load()).Categorize(ctx, description)
}
