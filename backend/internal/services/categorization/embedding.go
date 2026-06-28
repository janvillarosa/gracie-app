package categorization

import (
	"context"
	"sort"

	"github.com/janvillarosa/gracie-app/backend/internal/parse"
)

// EmbeddingCategorizer assigns categories by embedding the input text and
// finding the nearest anchors in its injected anchor set (kNN,
// similarity-weighted). It is domain-neutral — grocery items, list names, etc.
type EmbeddingCategorizer struct {
	embedder  Embedder
	anchorVec [][]float32 // normalized anchor embeddings, aligned with anchorCat
	anchorCat []string
	threshold float64
	topK      int
}

// NewEmbeddingCategorizerWithEmbedder builds the categorizer from an explicit
// Embedder and anchor list, embedding all anchors once. Used in tests and by
// NewEmbeddingCategorizer.
func NewEmbeddingCategorizerWithEmbedder(ctx context.Context, e Embedder, anchors []Anchor, threshold float64, topK int) (*EmbeddingCategorizer, error) {
	terms := make([]string, len(anchors))
	cats := make([]string, len(anchors))
	for i, a := range anchors {
		terms[i] = a.Term
		cats[i] = a.Category
	}
	raw, err := e.Embed(ctx, terms)
	if err != nil {
		return nil, err
	}
	vecs := make([][]float32, len(raw))
	for i, v := range raw {
		vecs[i] = normalize(v)
	}
	if topK < 1 {
		topK = 1
	}
	return &EmbeddingCategorizer{
		embedder:  e,
		anchorVec: vecs,
		anchorCat: cats,
		threshold: threshold,
		topK:      topK,
	}, nil
}

// Categorize: embed + kNN vote + threshold.
func (ec *EmbeddingCategorizer) Categorize(ctx context.Context, description string) (string, float64, error) {
	norm := parse.NormalizeKey(description)
	raw, err := ec.embedder.Embed(ctx, []string{norm})
	if err != nil {
		return "", 0, err
	}
	q := normalize(raw[0])

	neighbors := make([]scored, len(ec.anchorVec))
	for i := range ec.anchorVec {
		neighbors[i] = scored{category: ec.anchorCat[i], score: cosine(q, ec.anchorVec[i])}
	}
	sort.Slice(neighbors, func(i, j int) bool { return neighbors[i].score > neighbors[j].score })
	if len(neighbors) > ec.topK {
		neighbors = neighbors[:ec.topK]
	}

	cat, top := knnVote(neighbors)
	if float64(top) < ec.threshold {
		return "", float64(top), nil
	}
	return cat, float64(top), nil
}
