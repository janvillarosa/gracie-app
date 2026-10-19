package config

import (
	"fmt"
	"os"
	"time"
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
	// CategoryIndexEnabled toggles the Mongo-backed category cache.
	CategoryIndexEnabled bool
	// Trips & places
	TripsUserRPS float64
	// Behavior analytics
	AnalyticsEnabled       bool
	AnalyticsBuffer        int
	AnalyticsRetentionDays int
	AnalyticsEventsRPS     float64
	AnalyticsFoldEvery     time.Duration
	AnalyticsProfileEvery  time.Duration
	// SuggestionsMode is off or on (default). A retired "shadow" value runs as on.
	SuggestionsMode string
	// AutopilotTickEvery is how often the assist ticker runs; AutopilotLead how close a house's
	// next run must be before assist plans for it.
	AutopilotTickEvery time.Duration
	AutopilotLead      time.Duration
	// Push notifications (Web Push). Off unless both VAPID keys are set.
	VAPIDPublicKey    string
	VAPIDPrivateKey   string
	VAPIDSubject      string
	PushDispatchEvery time.Duration
	PushCoalesce      time.Duration
	PushRemindEvery   time.Duration
}

// PushEnabled reports whether push notifications are configured.
func (c *Config) PushEnabled() bool { return c.VAPIDPublicKey != "" && c.VAPIDPrivateKey != "" }

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
	cfg.CategoryIndexEnabled = getEnv("CATEGORY_INDEX_ENABLED", "true") == "true"
	cfg.TripsUserRPS = getEnvFloat("TRIPS_USER_RPS", 5)
	cfg.AnalyticsEnabled = getEnv("ANALYTICS_ENABLED", "true") == "true"
	cfg.AnalyticsBuffer = getEnvInt("ANALYTICS_BUFFER", 4096)
	cfg.AnalyticsRetentionDays = getEnvInt("ANALYTICS_RETENTION_DAYS", 400)
	cfg.AnalyticsEventsRPS = getEnvFloat("ANALYTICS_EVENTS_RPS", 2)
	cfg.AnalyticsFoldEvery = getEnvDuration("ANALYTICS_FOLD_EVERY", 15*time.Minute)
	cfg.AnalyticsProfileEvery = getEnvDuration("ANALYTICS_PROFILE_EVERY", time.Hour)
	cfg.SuggestionsMode = getEnv("SUGGESTIONS_MODE", "on")
	cfg.AutopilotTickEvery = getEnvDuration("AUTOPILOT_TICK_EVERY", 15*time.Minute)
	cfg.AutopilotLead = getEnvDuration("AUTOPILOT_LEAD", 18*time.Hour)
	cfg.VAPIDPublicKey = os.Getenv("VAPID_PUBLIC_KEY")
	cfg.VAPIDPrivateKey = os.Getenv("VAPID_PRIVATE_KEY")
	cfg.VAPIDSubject = getEnv("VAPID_SUBJECT", "mailto:admin@bauhouse.app")
	cfg.PushDispatchEvery = getEnvDuration("PUSH_DISPATCH_EVERY", 15*time.Second)
	cfg.PushCoalesce = getEnvDuration("PUSH_COALESCE", 90*time.Second)
	cfg.PushRemindEvery = getEnvDuration("PUSH_REMIND_EVERY", 15*time.Minute)

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

func getEnvDuration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			return d
		}
	}
	return def
}
