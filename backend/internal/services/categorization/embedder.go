package categorization

import "context"

// Embedder turns texts into fixed-length vectors. It abstracts the model
// backend so the categorizer logic is testable without loading a real model.
type Embedder interface {
	// Embed returns one vector per input text, in order.
	Embed(ctx context.Context, texts []string) ([][]float32, error)
	// Close releases any model resources.
	Close() error
}
