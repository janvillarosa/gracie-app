package config

import "testing"

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

