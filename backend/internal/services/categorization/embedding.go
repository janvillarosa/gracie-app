package categorization

import (
	"context"
	"sort"
	"strings"
)

// EmbeddingCategorizer assigns categories by embedding the input text and
// finding the nearest anchors in its injected anchor set (kNN,
// similarity-weighted). It is domain-neutral — grocery items, list names, etc.
type EmbeddingCategorizer struct {
	embedder  Embedder
	anchorVec [][]float32 // normalized anchor embeddings, aligned with anchorCat
	anchorCat []string
	exact     map[string]string // lowercased term -> category
	threshold float64
	topK      int
}

// NewEmbeddingCategorizerWithEmbedder builds the categorizer from an explicit
// Embedder and anchor list, embedding all anchors once. Used in tests and by
// NewEmbeddingCategorizer.
func NewEmbeddingCategorizerWithEmbedder(ctx context.Context, e Embedder, anchors []Anchor, threshold float64, topK int) (*EmbeddingCategorizer, error) {
	terms := make([]string, len(anchors))
	cats := make([]string, len(anchors))
	exact := make(map[string]string, len(anchors))
	for i, a := range anchors {
		terms[i] = a.Term
		cats[i] = a.Category
		// First rule wins on duplicate terms, matching ordered keyword priority.
		if _, ok := exact[a.Term]; !ok {
			exact[a.Term] = a.Category
		}
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
		exact:     exact,
		threshold: threshold,
		topK:      topK,
	}, nil
}

// Categorize: exact-match short-circuit, else embed + kNN vote + threshold.
func (ec *EmbeddingCategorizer) Categorize(ctx context.Context, description string) (string, float64, error) {
	norm := strings.ToLower(strings.Join(strings.Fields(description), " "))
	if cat, ok := ec.exact[norm]; ok {
		return cat, 1.0, nil
	}
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
		return "", float64(top), nil // decline; Chain applies fallback
	}
	return cat, float64(top), nil
}
