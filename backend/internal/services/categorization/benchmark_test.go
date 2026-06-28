package categorization

import (
	"context"
	"testing"
)

// benchCases is the full regression suite for the grocery domain.
var benchCases = []struct {
	desc string
	want string
}{
	// Edge cases with partial matches
	{"Butternut Squash", "Produce"},
	{"Banana Ketchup", "Pantry"},
	{"Peanut Butter", "Pantry"}, // Should stay Pantry, not Eggs & Dairy
	{"Butter", "Eggs & Dairy"},
	{"Banana", "Produce"},

	// New items
	{"Okra", "Produce"},
	{"Kimchi", "Pantry"},
	{"Bangus", "Meat & Seafood"},
	{"Milkfish", "Meat & Seafood"},
	{"Tilapia", "Meat & Seafood"},
	{"Galunggong", "Meat & Seafood"},

	// Filipino products
	{"Bagoong", "Pantry"},
	{"Patis", "Pantry"},

	// Existing items
	{"Milk", "Eggs & Dairy"},
	{"Chicken Breast", "Meat & Seafood"},
	{"Apples", "Produce"},
	{"Pasta", "Grains & Bakery"},
	{"Shampoo", "Household"},
	{"Coffee", "Beverages"},
	{"Frozen Pizza", "Frozen"},
	{"Tofu", "Plant-Based"},

	// Italian Products
	{"Piadina", "Grains & Bakery"},
	{"Lupini", "Pantry"},
	{"Canellini Beans", "Pantry"},
	{"Pesto", "Pantry"},
	{"Prosciutto", "Meat & Seafood"},
	{"Guanciale", "Meat & Seafood"},
	{"Mortadella", "Meat & Seafood"},
	{"Arborio Rice", "Grains & Bakery"},
	{"Focaccia", "Grains & Bakery"},
	{"Panettone", "Grains & Bakery"},
	{"Gnocchi", "Grains & Bakery"},
	{"Parmigiano", "Eggs & Dairy"},
	{"Pecorino", "Eggs & Dairy"},
	{"Grana Padano", "Eggs & Dairy"},
	{"Burrata", "Eggs & Dairy"},
	{"San Marzano", "Produce"},
	{"Balsamic Vinegar", "Pantry"},
	{"Truffle Oil", "Pantry"},

	// Filipino Products
	{"Dinorado Rice", "Grains & Bakery"},
	{"Purefoods Hotdog", "Meat & Seafood"},
	{"Hotdog", "Meat & Seafood"},
	{"Danggit", "Meat & Seafood"},
	{"Tocino", "Meat & Seafood"},
	{"Longganisa", "Meat & Seafood"},
	{"Corned Beef", "Meat & Seafood"},
	{"Spam", "Meat & Seafood"},
	{"Tuyo", "Meat & Seafood"},
	{"Pancit Bihon", "Grains & Bakery"},
	{"Sinigang Mix", "Pantry"},
	{"Mang Tomas", "Pantry"},
	{"Ube Halaya", "Pantry"},
	{"Calamansi", "Produce"},
	{"Eden Cheese", "Eggs & Dairy"},
	{"Pandesal", "Grains & Bakery"},
	{"Pan de Coco", "Grains & Bakery"},

	// Case sensitivity
	{"KIMCHI", "Pantry"},
	{"okra", "Produce"},
}

func accuracy(t *testing.T, c Categorizer) float64 {
	t.Helper()
	ctx := context.Background()
	hits := 0
	for _, tc := range benchCases {
		cat, _, err := c.Categorize(ctx, tc.desc)
		if err != nil {
			t.Fatalf("%q: %v", tc.desc, err)
		}
		if cat == "" {
			cat = General
		}
		if cat == tc.want {
			hits++
		}
	}
	return float64(hits) / float64(len(benchCases))
}

func TestChainAccuracyNoRegression(t *testing.T) {
	ctx := context.Background()
	emb, err := NewHugotEmbedder(ctx, modelDir(t)) // skips when TEST_MODEL_PATH unset
	if err != nil {
		t.Fatalf("load model: %v", err)
	}
	defer emb.Close()
	ec, err := NewEmbeddingCategorizerWithEmbedder(ctx, emb, GroceryAnchors, 0.45, 5)
	if err != nil {
		t.Fatal(err)
	}

	keyword := NewKeywordCategorizer(GroceryAnchors)
	chain := NewChain(General, keyword, ec)

	baseline := accuracy(t, keyword)
	embOnly := accuracy(t, ec)
	chainAcc := accuracy(t, chain)
	t.Logf("accuracy — keyword: %.1f%%, embedding-only: %.1f%%, chain: %.1f%%",
		baseline*100, embOnly*100, chainAcc*100)

	if chainAcc < baseline {
		t.Errorf("chain accuracy %.3f regressed below keyword baseline %.3f", chainAcc, baseline)
	}
}
