package categorization

import "context"

// Chain tries each member in order and returns the first non-empty category.
// A member that errors or declines ("") is skipped, giving graceful
// degradation (e.g. embedding model down -> keyword matcher). If every member
// declines, Chain returns its configured fallback label. The fallback is
// per-domain (grocery uses General; another domain might use "" or "Custom").
type Chain struct {
	fallback string
	members  []Categorizer
}

// NewChain builds a Chain with a fallback label and strategies in priority order.
func NewChain(fallback string, members ...Categorizer) *Chain {
	return &Chain{fallback: fallback, members: members}
}

func (c *Chain) Categorize(ctx context.Context, description string) (string, float64, error) {
	for _, m := range c.members {
		cat, conf, err := m.Categorize(ctx, description)
		if err != nil || cat == "" {
			continue
		}
		return cat, conf, nil
	}
	return c.fallback, 0, nil
}
