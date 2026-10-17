package categorization

import (
	"context"
	"sync"
	"testing"
)

func TestSwappableServesInitialThenReplacement(t *testing.T) {
	s := NewSwappable(stub{cat: "keyword"})
	if cat, _, _ := s.Categorize(context.Background(), "milk"); cat != "keyword" {
		t.Fatalf("before swap: %q", cat)
	}
	s.Swap(stub{cat: "embedding"})
	if cat, _, _ := s.Categorize(context.Background(), "milk"); cat != "embedding" {
		t.Fatalf("after swap: %q", cat)
	}
}

func TestSwappableIsRaceFree(t *testing.T) {
	s := NewSwappable(stub{cat: "a"})
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(2)
		go func() { defer wg.Done(); _, _, _ = s.Categorize(context.Background(), "x") }()
		go func() { defer wg.Done(); s.Swap(stub{cat: "b"}) }()
	}
	wg.Wait()
}
