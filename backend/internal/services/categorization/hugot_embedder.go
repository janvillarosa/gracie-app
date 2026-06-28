package categorization

import (
	"context"
	"fmt"
	"log"

	"github.com/knights-analytics/hugot"
	"github.com/knights-analytics/hugot/pipelines"
)

// HugotEmbedder runs a sentence-embedding ONNX model via hugot's pure-Go
// backend (no CGO, no native libraries). Construct once at startup and reuse.
type HugotEmbedder struct {
	session  *hugot.Session
	pipeline *pipelines.FeatureExtractionPipeline
}

var _ Embedder = (*HugotEmbedder)(nil)

// NewHugotEmbedder loads the model directory at modelPath and returns a ready
// embedder. The caller must call Close() when done.
func NewHugotEmbedder(ctx context.Context, modelPath string) (*HugotEmbedder, error) {
	session, err := hugot.NewGoSession(ctx)
	if err != nil {
		return nil, fmt.Errorf("hugot session: %w", err)
	}

	config := hugot.FeatureExtractionConfig{
		ModelPath: modelPath,
		Name:      "grocery-embed",
	}

	pipeline, err := hugot.NewPipeline[*pipelines.FeatureExtractionPipeline](session, config)
	if err != nil {
		if cerr := session.Destroy(); cerr != nil {
			log.Printf("hugot: session cleanup after pipeline error: %v", cerr)
		}
		return nil, fmt.Errorf("hugot pipeline: %w", err)
	}

	return &HugotEmbedder{session: session, pipeline: pipeline}, nil
}

// Embed returns one vector per input text, in the same order. Vectors are NOT
// pre-normalized here — callers that need L2-normalized vectors should call
// normalize() from vector.go.
func (h *HugotEmbedder) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	out, err := h.pipeline.RunPipeline(ctx, texts)
	if err != nil {
		return nil, fmt.Errorf("hugot run: %w", err)
	}
	return out.Embeddings, nil
}

// Close releases the model session and all associated resources.
func (h *HugotEmbedder) Close() error {
	if h.session != nil {
		err := h.session.Destroy()
		h.session = nil
		return err
	}
	return nil
}
