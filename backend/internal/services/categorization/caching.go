package categorization

import (
	"context"
	"log"

	"github.com/janvillarosa/gracie-app/backend/internal/parse"
)

// CategoryIndex is the persistent exact-match cache.
// The Mongo repo (store/mongo.CategoryIndexRepo) satisfies this interface.
type CategoryIndex interface {
	Lookup(ctx context.Context, key string) (category string, found bool, err error)
	Upsert(ctx context.Context, key, category string) error
}

// CachingCategorizer wraps a Categorizer with a persistent index lookup.
type CachingCategorizer struct {
	inner Categorizer
	index CategoryIndex
}

// NewCachingCategorizer returns a new CachingCategorizer that wraps inner
// and uses index for lookups and write-through caching.
func NewCachingCategorizer(inner Categorizer, index CategoryIndex) *CachingCategorizer {
	return &CachingCategorizer{
		inner: inner,
		index: index,
	}
}

// Categorize implements Categorizer by checking the index first,
// then delegating to the inner categorizer on miss, with write-through caching.
func (c *CachingCategorizer) Categorize(ctx context.Context, description string) (string, float64, error) {
	// Normalize the key
	key := parse.NormalizeKey(description)

	// Try to lookup in the index
	cat, found, err := c.index.Lookup(ctx, key)
	if err != nil {
		// Log but treat as a miss
		log.Printf("caching categorizer: lookup error: %v", err)
	} else if found {
		// Cache hit
		return cat, 1.0, nil
	}

	// Cache miss: call inner with normalized text
	cat, conf, err := c.inner.Categorize(ctx, key)
	if err != nil {
		// Propagate inner error without caching
		return "", conf, err
	}

	// Write-through cache: only cache non-empty, non-General results
	if cat != "" && cat != General {
		if upsertErr := c.index.Upsert(ctx, key, cat); upsertErr != nil {
			log.Printf("caching categorizer: upsert error: %v", upsertErr)
		}
	}

	return cat, conf, nil
}
