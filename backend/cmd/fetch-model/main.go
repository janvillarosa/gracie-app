// Command fetch-model downloads the sentence-embedding model into a target
// directory at build time, so the running image needs no runtime network access.
//
// Usage: fetch-model [output-dir]
//
// Env vars:
//
//	EMBEDDING_MODEL_ID  HuggingFace model ID (default: KnightsAnalytics/all-MiniLM-L6-v2)
//	HF_TOKEN           Optional HuggingFace auth token for private/gated models
package main

import (
	"context"
	"log"
	"os"

	"github.com/knights-analytics/hugot"
)

func main() {
	out := "./models"
	if len(os.Args) > 1 {
		out = os.Args[1]
	}
	modelID := os.Getenv("EMBEDDING_MODEL_ID")
	if modelID == "" {
		modelID = "KnightsAnalytics/all-MiniLM-L6-v2"
	}

	opts := hugot.NewDownloadOptions()
	opts.Verbose = true
	if token := os.Getenv("HF_TOKEN"); token != "" {
		opts.AuthToken = token
	}

	ctx := context.Background()
	path, err := hugot.DownloadModel(ctx, modelID, out, opts)
	if err != nil {
		log.Fatalf("download model %s: %v", modelID, err)
	}
	log.Printf("model downloaded to %s", path)
}
