package auth

import (
    "net/http"
    "testing"
)

func TestDeriveLookup(t *testing.T) {
    l := DeriveLookup("test-key")
    if len(l) != 64 {
        t.Fatalf("expected 64-char hex, got %d", len(l))
    }
}

func TestGenerateAndVerify(t *testing.T) {
    plain, hash, err := GenerateAPIKey()
    if err != nil {
        t.Fatalf("generate: %v", err)
    }
    if plain == "" || hash == "" {
        t.Fatalf("expected non-empty key and hash")
    }
    if !VerifyAPIKey(hash, plain) {
        t.Fatalf("verify failed")
    }
}

func TestExtractBearer(t *testing.T) {
    req := func(h string) *http.Request {
        r, _ := http.NewRequest("GET", "http://example/", nil)
        if h != "" { r.Header.Set("Authorization", h) }
        return r
    }
    if _, ok := ExtractBearer(req("")); ok { t.Fatalf("expected no token") }
    if _, ok := ExtractBearer(req("Basic abc")); ok { t.Fatalf("expected no token for Basic") }
    if tok, ok := ExtractBearer(req("Bearer   ")); ok || tok != "" { t.Fatalf("expected empty token not ok") }
    if tok, ok := ExtractBearer(req("Bearer real")); !ok || tok != "real" { t.Fatalf("unexpected: %v %v", tok, ok) }
}
