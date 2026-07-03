package mongo

import (
	"context"
	"testing"
	"time"
)

func TestCategoryIndexRepoLookupMissEmpty(t *testing.T) {
	c := connectOrSkip(t)
	r := NewCategoryIndexRepo(c)
	if err := r.EnsureIndexes(context.Background()); err != nil {
		t.Fatalf("ensure indexes: %v", err)
	}

	// Miss on empty collection
	category, found, err := r.Lookup(context.Background(), "chicken breast")
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if found {
		t.Fatalf("expected not found, got found")
	}
	if category != "" {
		t.Fatalf("expected empty category, got %q", category)
	}
}

func TestCategoryIndexRepoUpsertThenLookup(t *testing.T) {
	c := connectOrSkip(t)
	r := NewCategoryIndexRepo(c)
	if err := r.EnsureIndexes(context.Background()); err != nil {
		t.Fatalf("ensure indexes: %v", err)
	}

	// Upsert then Lookup hit
	key := "chicken breast"
	category := "Meat & Seafood"
	if err := r.Upsert(context.Background(), key, category); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	got, found, err := r.Lookup(context.Background(), key)
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if !found {
		t.Fatalf("expected found, got not found")
	}
	if got != category {
		t.Fatalf("expected %q, got %q", category, got)
	}
}

func TestCategoryIndexRepoReUpsertLastWriterWins(t *testing.T) {
	c := connectOrSkip(t)
	r := NewCategoryIndexRepo(c)
	if err := r.EnsureIndexes(context.Background()); err != nil {
		t.Fatalf("ensure indexes: %v", err)
	}

	// Re-upsert same key with different category (last-writer-wins)
	key := "tomato"
	cat1 := "Vegetables"
	cat2 := "Produce"

	if err := r.Upsert(context.Background(), key, cat1); err != nil {
		t.Fatalf("upsert 1: %v", err)
	}

	// Small delay to ensure updated_at differs
	time.Sleep(10 * time.Millisecond)

	if err := r.Upsert(context.Background(), key, cat2); err != nil {
		t.Fatalf("upsert 2: %v", err)
	}

	got, found, err := r.Lookup(context.Background(), key)
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if !found {
		t.Fatalf("expected found, got not found")
	}
	if got != cat2 {
		t.Fatalf("expected %q (last write), got %q", cat2, got)
	}
}

func TestCategoryIndexRepoSeedIdempotent(t *testing.T) {
	c := connectOrSkip(t)
	r := NewCategoryIndexRepo(c)
	if err := r.EnsureIndexes(context.Background()); err != nil {
		t.Fatalf("ensure indexes: %v", err)
	}

	// Seed is idempotent
	entries := []CategoryIndexEntry{
		{Key: "apple", Category: "Fruits"},
		{Key: "carrot", Category: "Vegetables"},
	}

	if err := r.Seed(context.Background(), entries); err != nil {
		t.Fatalf("seed 1: %v", err)
	}

	// Call seed again with same data
	if err := r.Seed(context.Background(), entries); err != nil {
		t.Fatalf("seed 2: %v", err)
	}

	// Verify data is correct
	got, found, err := r.Lookup(context.Background(), "apple")
	if err != nil {
		t.Fatalf("lookup apple: %v", err)
	}
	if !found {
		t.Fatalf("expected apple found")
	}
	if got != "Fruits" {
		t.Fatalf("expected Fruits, got %q", got)
	}

	got2, found2, err := r.Lookup(context.Background(), "carrot")
	if err != nil {
		t.Fatalf("lookup carrot: %v", err)
	}
	if !found2 {
		t.Fatalf("expected carrot found")
	}
	if got2 != "Vegetables" {
		t.Fatalf("expected Vegetables, got %q", got2)
	}
}

func TestCategoryIndexRepoSeedEmptyNoOp(t *testing.T) {
	c := connectOrSkip(t)
	r := NewCategoryIndexRepo(c)
	if err := r.EnsureIndexes(context.Background()); err != nil {
		t.Fatalf("ensure indexes: %v", err)
	}

	// Empty seed should be no-op
	if err := r.Seed(context.Background(), []CategoryIndexEntry{}); err != nil {
		t.Fatalf("seed empty: %v", err)
	}
}
