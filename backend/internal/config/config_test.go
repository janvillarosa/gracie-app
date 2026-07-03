package config

import (
	"os"
	"testing"
)

func TestLoadDefaults(t *testing.T) {
    // Clear relevant env to force defaults
    t.Setenv("PORT", "")
    t.Setenv("AWS_REGION", "")
    t.Setenv("DDB_ENDPOINT", "")
    t.Setenv("USERS_TABLE", "")
    t.Setenv("ROOMS_TABLE", "")

    cfg, err := Load()
    if err != nil { t.Fatalf("load: %v", err) }
    if cfg.Port != "8080" { t.Fatalf("port default: %s", cfg.Port) }
    if cfg.AWSRegion != "us-east-1" { t.Fatalf("region default: %s", cfg.AWSRegion) }
    if cfg.DDBEndpoint != "http://localhost:8000" { t.Fatalf("endpoint default: %s", cfg.DDBEndpoint) }
    if cfg.UsersTable != "Users" || cfg.RoomsTable != "Rooms" { t.Fatalf("table defaults: %s %s", cfg.UsersTable, cfg.RoomsTable) }
}

func TestLoadEnvOverrides(t *testing.T) {
    t.Setenv("PORT", "9999")
    t.Setenv("AWS_REGION", "local-1")
    t.Setenv("DDB_ENDPOINT", "http://ddb:8000")
    t.Setenv("USERS_TABLE", "U")
    t.Setenv("ROOMS_TABLE", "R")

    cfg, err := Load()
    if err != nil { t.Fatalf("load: %v", err) }
    if cfg.Port != "9999" || cfg.AWSRegion != "local-1" || cfg.DDBEndpoint != "http://ddb:8000" { t.Fatalf("env not applied") }
    if cfg.UsersTable != "U" || cfg.RoomsTable != "R" { t.Fatalf("tables not applied") }
}

func TestEmbeddingDefaults(t *testing.T) {
	for _, k := range []string{"EMBEDDING_ENABLED", "EMBEDDING_MODEL_PATH", "EMBED_THRESHOLD", "EMBED_TOPK", "CATEGORY_INDEX_ENABLED"} {
		os.Unsetenv(k)
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

