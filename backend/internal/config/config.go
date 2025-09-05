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
    ListsTable  string
    ListItemsTable string
    EncKeyFile  string
    APIKeyTTLHours int
    // Store selection: "dynamo" (default) or "mongo"
    DataStore   string
    // Mongo settings (used when DataStore == "mongo")
    MongoURI    string
    MongoDB     string
    // AvatarSalt is used to derive deterministic avatar keys (HMAC of user_id).
    AvatarSalt  string
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
        ListsTable:  getEnv("LISTS_TABLE", "Lists"),
        ListItemsTable: getEnv("LIST_ITEMS_TABLE", "ListItems"),
        EncKeyFile:  getEnv("ENC_KEY_FILE", "/app/secrets/enc.key"),
        APIKeyTTLHours: getEnvInt("API_KEY_TTL_HOURS", 720),
        DataStore:   getEnv("DATA_STORE", "mongo"),
        MongoURI:    getEnv("MONGODB_URI", "mongodb://localhost:27017"),
        MongoDB:     getEnv("MONGODB_DB", "gracie"),
        AvatarSalt:  getEnv("AVATAR_SALT", "local-avatar-salt"),
    }

    // If DDB_ENDPOINT is explicitly set to "aws", use AWS-managed DynamoDB (no custom endpoint)
    if v, ok := os.LookupEnv("DDB_ENDPOINT"); ok {
        if v == "aws" {
            cfg.DDBEndpoint = ""
        }
    }

    if cfg.UsersTable == "" || cfg.RoomsTable == "" || cfg.ListsTable == "" || cfg.ListItemsTable == "" {
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
