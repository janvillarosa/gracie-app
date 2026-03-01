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
