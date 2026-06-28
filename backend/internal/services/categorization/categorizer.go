// Package categorization assigns a grocery category to a free-text item
// description. It exposes a Categorizer interface with three strategies:
// keyword substring matching, semantic embedding kNN, and a fallback Chain.
package categorization

import "context"

// Categorizer assigns a category to a description. See the plan's
// "Categorizer Contract" for the decline ("") and error semantics.
type Categorizer interface {
	Categorize(ctx context.Context, description string) (category string, confidence float64, err error)
}

// General is the fallback category for items no strategy can place.
const General = "General"
