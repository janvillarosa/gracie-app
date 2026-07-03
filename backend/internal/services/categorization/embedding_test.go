package categorization

import (
	"context"
	"testing"
)

// fakeEmbedder maps known phrases to fixed 2-D vectors so cosine results are
// predictable. Unknown phrases map to a far-away vector.
type fakeEmbedder struct{}

func (fakeEmbedder) Close() error { return nil }
func (fakeEmbedder) Embed(_ context.Context, texts []string) ([][]float32, error) {
	vecs := map[string][]float32{
		"milk":       {1, 0},
		"whole milk": {0.98, 0.20}, // near "milk"
		"cheddar":    {0, 1},
		"xyzzy":      {-1, -1}, // far from everything
	}
	out := make([][]float32, len(texts))
	for i, t := range texts {
		if v, ok := vecs[t]; ok {
			out[i] = v
		} else {
			out[i] = []float32{-1, -1}
		}
	}
	return out, nil
}

func newTestCategorizer(t *testing.T) *EmbeddingCategorizer {
	t.Helper()
	anchors := []Anchor{
		{Term: "milk", Category: "Eggs & Dairy"},
		{Term: "cheddar", Category: "Eggs & Dairy"},
	}
	ec, err := NewEmbeddingCategorizerWithEmbedder(context.Background(), fakeEmbedder{}, anchors, 0.5, 5)
	if err != nil {
		t.Fatalf("build categorizer: %v", err)
	}
	return ec
}

func TestEmbeddingNearestNeighbor(t *testing.T) {
	ec := newTestCategorizer(t)
	cat, conf, err := ec.Categorize(context.Background(), "whole milk")
	if err != nil {
		t.Fatal(err)
	}
	if cat != "Eggs & Dairy" {
		t.Errorf("got %q, want Eggs & Dairy", cat)
	}
	if conf < 0.9 {
		t.Errorf("confidence %v, want >= 0.9", conf)
	}
}

func TestEmbeddingBelowThresholdDeclines(t *testing.T) {
	ec := newTestCategorizer(t)
	cat, _, err := ec.Categorize(context.Background(), "xyzzy")
	if err != nil {
		t.Fatal(err)
	}
	if cat != "" {
		t.Errorf("got %q, want \"\" (decline)", cat)
	}
}
