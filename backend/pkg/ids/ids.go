package ids

import (
    "crypto/rand"
    "encoding/base64"
    "encoding/hex"
    "fmt"
)

// NewID returns a 16-byte random hex string (32 chars).
func NewID(prefix string) string {
    b := make([]byte, 16)
    _, _ = rand.Read(b)
    if prefix != "" {
        return fmt.Sprintf("%s_%s", prefix, hex.EncodeToString(b))
    }
    return hex.EncodeToString(b)
}

// NewToken returns a URL-safe 32-byte random token.
func NewToken() string {
    b := make([]byte, 32)
    _, _ = rand.Read(b)
    return base64.RawURLEncoding.EncodeToString(b)
}

// NewShareToken5 returns a 5-character, unambiguous alphanumeric code.
// Alphabet excludes the confusing letters I, O, and L.
func NewShareToken5() string {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ0123456789" // no I, O, L
    const n = 5
    out := make([]byte, n)
    rb := make([]byte, n)
    _, _ = rand.Read(rb)
    for i := 0; i < n; i++ {
        out[i] = alphabet[int(rb[i])%len(alphabet)]
    }
    return string(out)
}
