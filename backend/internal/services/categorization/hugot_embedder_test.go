package categorization

import (
	"context"
	"os"
	"testing"
)

func modelDir(t *testing.T) string {
	t.Helper()
	p := os.Getenv("TEST_MODEL_PATH")
	if p == "" {
		t.Skip("TEST_MODEL_PATH not set; skipping model integration test")
	}
	return p
}

func TestHugotEmbedderRealModel(t *testing.T) {
	ctx := context.Background()
	emb, err := NewHugotEmbedder(ctx, modelDir(t))
	if err != nil {
		t.Fatalf("load model: %v", err)
	}
	defer emb.Close()

	vecs, err := emb.Embed(ctx, []string{"milk", "whole milk", "screwdriver"})
	if err != nil {
		t.Fatalf("embed: %v", err)
	}
	if len(vecs) != 3 || len(vecs[0]) == 0 {
		t.Fatalf("unexpected embedding shape: %d vectors", len(vecs))
	}
	// "milk" and "whole milk" should be semantically closer than "milk" and "screwdriver"
	near := cosine(normalize(vecs[0]), normalize(vecs[1]))
	far := cosine(normalize(vecs[0]), normalize(vecs[2]))
	if near <= far {
		t.Errorf("expected milk~whole milk (%.3f) > milk~screwdriver (%.3f)", near, far)
	}
}

func TestEmbeddingCategorizerRealModel(t *testing.T) {
	ctx := context.Background()
	emb, err := NewHugotEmbedder(ctx, modelDir(t))
	if err != nil {
		t.Fatalf("load model: %v", err)
	}
	defer emb.Close()

	ec, err := NewEmbeddingCategorizerWithEmbedder(ctx, emb, GroceryAnchors, 0.45, 5)
	if err != nil {
		t.Fatalf("build categorizer: %v", err)
	}
	cat, conf, err := ec.Categorize(ctx, "ribeye steak")
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("ribeye steak -> %s (%.3f)", cat, conf)
	if cat != "Meat & Seafood" {
		t.Errorf("got %q, want Meat & Seafood", cat)
	}
}
