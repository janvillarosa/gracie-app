package auth

import (
    "crypto/sha256"
    "crypto/subtle"
    "encoding/hex"
    "net/http"
    "strings"

    "golang.org/x/crypto/bcrypt"
)

const (
    bearerPrefix = "Bearer "
)

func GenerateAPIKey() (plain string, hash string, err error) {
    // Use 32-byte random token base64url
    plain = randomToken()
    hashed, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
    if err != nil {
        return "", "", err
    }
    return plain, string(hashed), nil
}

func VerifyAPIKey(hash string, plain string) bool {
    // Constant-time compare via bcrypt
    if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)); err != nil {
        return false
    }
    return true
}

func ExtractBearer(r *http.Request) (string, bool) {
    h := r.Header.Get("Authorization")
    if h == "" {
        return "", false
    }
    if !strings.HasPrefix(h, bearerPrefix) {
        return "", false
    }
    token := strings.TrimSpace(strings.TrimPrefix(h, bearerPrefix))
    if token == "" {
        return "", false
    }
    return token, true
}

func constantTimeEqual(a, b string) bool {
    if len(a) != len(b) {
        return false
    }
    return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// DeriveLookup computes a deterministic hex-encoded SHA-256 of the API key.
// Use this as a GSI partition key to find users by API key without scanning.
func DeriveLookup(apiKey string) string {
    sum := sha256.Sum256([]byte(apiKey))
    return hex.EncodeToString(sum[:])
}
