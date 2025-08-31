package auth

import (
    "crypto/rand"
    "encoding/base64"
)

func randomToken() string {
    b := make([]byte, 32)
    _, _ = rand.Read(b)
    return base64.RawURLEncoding.EncodeToString(b)
}

