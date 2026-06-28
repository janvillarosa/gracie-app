package categorization

import (
	"math"
	"testing"
)

func almost(a, b float32) bool { return math.Abs(float64(a-b)) < 1e-5 }

func TestCosineIdenticalIsOne(t *testing.T) {
	a := []float32{1, 2, 3}
	if got := cosine(a, a); !almost(got, 1.0) {
		t.Errorf("cosine(a,a) = %v, want 1.0", got)
	}
}

func TestCosineOrthogonalIsZero(t *testing.T) {
	if got := cosine([]float32{1, 0}, []float32{0, 1}); !almost(got, 0.0) {
		t.Errorf("cosine = %v, want 0.0", got)
	}
}

func TestNormalizeUnitLength(t *testing.T) {
	v := normalize([]float32{3, 4})
	if !almost(v[0], 0.6) || !almost(v[1], 0.8) {
		t.Errorf("normalize([3,4]) = %v, want [0.6 0.8]", v)
	}
}

func TestKNNVoteWeightsBySimilarity(t *testing.T) {
	// Two "Produce" neighbors at 0.9/0.8 outvote one "Pantry" at 0.85.
	neighbors := []scored{
		{category: "Produce", score: 0.9},
		{category: "Pantry", score: 0.85},
		{category: "Produce", score: 0.8},
	}
	cat, top := knnVote(neighbors)
	if cat != "Produce" {
		t.Errorf("knnVote category = %q, want Produce", cat)
	}
	if !almost(top, 0.9) {
		t.Errorf("knnVote top score = %v, want 0.9", top)
	}
}
