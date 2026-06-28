package categorization

import (
	"context"
	"strings"
)

// KeywordCategorizer matches a lowercased description against an injected
// anchor set using ordered substring matching. It is domain-neutral and serves
// as the permanent fallback strategy for any domain.
type KeywordCategorizer struct {
	anchors []Anchor
}

// NewKeywordCategorizer builds a matcher over the given anchor set (e.g. GroceryAnchors).
func NewKeywordCategorizer(anchors []Anchor) *KeywordCategorizer {
	return &KeywordCategorizer{anchors: anchors}
}

// Categorize returns (category, 1.0, nil) on the first substring match, or
// ("", 0, nil) when nothing matches (declines; the Chain applies its fallback).
func (k *KeywordCategorizer) Categorize(_ context.Context, description string) (string, float64, error) {
	d := strings.ToLower(description)
	for _, r := range k.anchors {
		if strings.Contains(d, r.Term) {
			return r.Category, 1.0, nil
		}
	}
	return "", 0, nil
}
