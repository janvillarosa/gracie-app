package services

import (
	"testing"
)

func TestAutoCategorize(t *testing.T) {
	ls := &ListService{}

	tests := []struct {
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

		// Case sensitivity
		{"KIMCHI", "Pantry"},
		{"okra", "Produce"},

		// General fallback
		{"Laptop", "General"},
	}

	for _, tt := range tests {
		t.Run(tt.desc, func(t *testing.T) {
			if got := ls.autoCategorize(tt.desc); got != tt.want {
				t.Errorf("autoCategorize(%q) = %q, want %q", tt.desc, got, tt.want)
			}
		})
	}
}
