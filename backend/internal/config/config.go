package config

import (
    "fmt"
    "os"
)

type Config struct {
    Port        string
    AWSRegion   string
    DDBEndpoint string
    UsersTable  string
    RoomsTable  string
    EncKeyFile  string
    APIKeyTTLHours int
}

func getEnv(key, def string) string {
    if v := os.Getenv(key); v != "" {
        return v
    }
    return def
}

func Load() (*Config, error) {
    cfg := &Config{
        Port:        getEnv("PORT", "8080"),
        AWSRegion:   getEnv("AWS_REGION", "us-east-1"),
        DDBEndpoint: getEnv("DDB_ENDPOINT", "http://localhost:8000"),
        UsersTable:  getEnv("USERS_TABLE", "Users"),
        RoomsTable:  getEnv("ROOMS_TABLE", "Rooms"),
        EncKeyFile:  getEnv("ENC_KEY_FILE", "/app/secrets/enc.key"),
        APIKeyTTLHours: getEnvInt("API_KEY_TTL_HOURS", 720),
    }

    if cfg.UsersTable == "" || cfg.RoomsTable == "" {
        return nil, fmt.Errorf("missing table names")
    }
    return cfg, nil
}

func getEnvInt(key string, def int) int {
    if v := os.Getenv(key); v != "" {
        var n int
        _, _ = fmt.Sscanf(v, "%d", &n)
        if n > 0 { return n }
    }
    return def
}
