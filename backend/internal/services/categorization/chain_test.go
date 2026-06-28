package categorization

import (
	"context"
	"errors"
	"testing"
)

// stub is a Categorizer returning a fixed result.
type stub struct {
	cat  string
	conf float64
	err  error
}

func (s stub) Categorize(context.Context, string) (string, float64, error) {
	return s.cat, s.conf, s.err
}

func TestChainUsesFirstNonEmpty(t *testing.T) {
	c := NewChain(General, stub{cat: "Produce", conf: 0.8}, stub{cat: "Pantry", conf: 1.0})
	cat, _, _ := c.Categorize(context.Background(), "x")
	if cat != "Produce" {
		t.Errorf("got %q, want Produce", cat)
	}
}

func TestChainFallsBackOnDecline(t *testing.T) {
	c := NewChain(General, stub{cat: ""}, stub{cat: "Pantry", conf: 1.0})
	cat, _, _ := c.Categorize(context.Background(), "x")
	if cat != "Pantry" {
		t.Errorf("got %q, want Pantry", cat)
	}
}

func TestChainFallsBackOnError(t *testing.T) {
	c := NewChain(General, stub{err: errors.New("model down")}, stub{cat: "Pantry", conf: 1.0})
	cat, _, err := c.Categorize(context.Background(), "x")
	if err != nil {
		t.Fatalf("chain should swallow member error, got %v", err)
	}
	if cat != "Pantry" {
		t.Errorf("got %q, want Pantry", cat)
	}
}

func TestChainAllDeclineReturnsConfiguredFallback(t *testing.T) {
	c := NewChain("Custom", stub{cat: ""}, stub{cat: ""})
	cat, _, _ := c.Categorize(context.Background(), "x")
	if cat != "Custom" {
		t.Errorf("got %q, want Custom (configured fallback)", cat)
	}
}
