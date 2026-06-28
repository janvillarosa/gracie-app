package categorization

import (
	"math"
	"sort"
)

// scored is one neighbor's category and its cosine similarity to the query.
type scored struct {
	category string
	score    float32
}

// cosine returns the cosine similarity of two equal-length vectors.
func cosine(a, b []float32) float32 {
	var dot, na, nb float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		na += float64(a[i]) * float64(a[i])
		nb += float64(b[i]) * float64(b[i])
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return float32(dot / (math.Sqrt(na) * math.Sqrt(nb)))
}

// normalize returns the L2-normalized copy of v (zero vector returned as-is).
func normalize(v []float32) []float32 {
	var n float64
	for _, x := range v {
		n += float64(x) * float64(x)
	}
	if n == 0 {
		return v
	}
	inv := float32(1.0 / math.Sqrt(n))
	out := make([]float32, len(v))
	for i, x := range v {
		out[i] = x * inv
	}
	return out
}

// knnVote sums similarity per category across the given neighbors and returns
// the winning category plus the single highest neighbor score (used as the
// confidence / threshold value).
func knnVote(neighbors []scored) (string, float32) {
	weight := map[string]float32{}
	var top float32
	for _, n := range neighbors {
		weight[n.category] += n.score
		if n.score > top {
			top = n.score
		}
	}
	// Deterministic winner: highest weight, ties broken by category name.
	type kv struct {
		cat string
		w   float32
	}
	pairs := make([]kv, 0, len(weight))
	for c, w := range weight {
		pairs = append(pairs, kv{c, w})
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].w != pairs[j].w {
			return pairs[i].w > pairs[j].w
		}
		return pairs[i].cat < pairs[j].cat
	})
	if len(pairs) == 0 {
		return "", 0
	}
	return pairs[0].cat, top
}
