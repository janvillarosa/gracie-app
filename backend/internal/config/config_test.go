package config

import (
	"os"
	"testing"
)

func TestLoadDefaults(t *testing.T) {
	// Clear relevant env to force defaults
	t.Setenv("PORT", "")
	t.Setenv("MONGODB_URI", "")
	t.Setenv("MONGODB_DB", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.Port != "8080" {
		t.Fatalf("port default: %s", cfg.Port)
	}
	if cfg.MongoURI != "mongodb://localhost:27017" {
		t.Fatalf("mongo uri default: %s", cfg.MongoURI)
	}
	if cfg.MongoDB != "gracie" {
		t.Fatalf("mongo db default: %s", cfg.MongoDB)
	}
}

func TestLoadEnvOverrides(t *testing.T) {
	t.Setenv("PORT", "9999")
	t.Setenv("MONGODB_URI", "mongodb://mongo:27017/?replicaSet=rs0")
	t.Setenv("MONGODB_DB", "gracie_custom")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.Port != "9999" {
		t.Fatalf("port not applied: %s", cfg.Port)
	}
	if cfg.MongoURI != "mongodb://mongo:27017/?replicaSet=rs0" {
		t.Fatalf("mongo uri not applied: %s", cfg.MongoURI)
	}
	if cfg.MongoDB != "gracie_custom" {
		t.Fatalf("mongo db not applied: %s", cfg.MongoDB)
	}
}

func TestEmbeddingDefaults(t *testing.T) {
	for _, k := range []string{"EMBEDDING_ENABLED", "EMBEDDING_MODEL_PATH", "EMBED_THRESHOLD", "EMBED_TOPK", "CATEGORY_INDEX_ENABLED"} {
		_ = os.Unsetenv(k)
	}
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.EmbeddingEnabled {
		t.Errorf("EmbeddingEnabled default = true, want false")
	}
	if cfg.EmbeddingModelPath != "/app/models/minilm" {
		t.Errorf("EmbeddingModelPath = %q", cfg.EmbeddingModelPath)
	}
	if cfg.EmbedThreshold != 0.45 {
		t.Errorf("EmbedThreshold = %v, want 0.45", cfg.EmbedThreshold)
	}
	if cfg.EmbedTopK != 5 {
		t.Errorf("EmbedTopK = %v, want 5", cfg.EmbedTopK)
	}
	if !cfg.CategoryIndexEnabled {
		t.Errorf("CategoryIndexEnabled default = false, want true")
	}
}

func TestTripsDefaultsAndOverride(t *testing.T) {
	t.Setenv("MONGODB_URI", "mongodb://x")
	t.Setenv("MONGODB_DB", "x")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.TripsUserRPS != 5 {
		t.Fatalf("defaults: %+v", cfg)
	}
	t.Setenv("TRIPS_USER_RPS", "9")
	cfg, _ = Load()
	if cfg.TripsUserRPS != 9 {
		t.Fatalf("overrides: %+v", cfg)
	}
}
