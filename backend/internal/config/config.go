package config

import (
	"fmt"
	"os"
)

type Config struct {
	Port           string
	EncKeyFile     string
	APIKeyTTLHours int
	// Mongo settings (the only supported store)
	MongoURI string
	MongoDB  string
	// AvatarSalt is used to derive deterministic avatar keys (HMAC of user_id).
	AvatarSalt string
	// Embedding categorization
	EmbeddingEnabled   bool
	EmbeddingModelPath string
	EmbedThreshold     float64
	EmbedTopK          int
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func Load() (*Config, error) {
	cfg := &Config{
		Port:           getEnv("PORT", "8080"),
		EncKeyFile:     getEnv("ENC_KEY_FILE", "/app/secrets/enc.key"),
		APIKeyTTLHours: getEnvInt("API_KEY_TTL_HOURS", 720),
		MongoURI:       getEnv("MONGODB_URI", "mongodb://localhost:27017"),
		MongoDB:        getEnv("MONGODB_DB", "gracie"),
		AvatarSalt:     getEnv("AVATAR_SALT", "local-avatar-salt"),
	}

	cfg.EmbeddingEnabled = getEnv("EMBEDDING_ENABLED", "false") == "true"
	cfg.EmbeddingModelPath = getEnv("EMBEDDING_MODEL_PATH", "/app/models/minilm")
	cfg.EmbedThreshold = getEnvFloat("EMBED_THRESHOLD", 0.45)
	cfg.EmbedTopK = getEnvInt("EMBED_TOPK", 5)

	if cfg.MongoURI == "" || cfg.MongoDB == "" {
		return nil, fmt.Errorf("missing Mongo configuration (MONGODB_URI, MONGODB_DB)")
	}
	return cfg, nil
}

func getEnvInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		var n int
		_, _ = fmt.Sscanf(v, "%d", &n)
		if n > 0 {
			return n
		}
	}
	return def
}

func getEnvFloat(key string, def float64) float64 {
	if v := os.Getenv(key); v != "" {
		var f float64
		if _, err := fmt.Sscanf(v, "%g", &f); err == nil && f > 0 {
			return f
		}
	}
	return def
}
