package ids

import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/base32"
)

// DeriveAvatarKey returns a short, deterministic string derived from userID and salt.
// Uses HMAC-SHA256(userID, salt) encoded as base32 (no padding), truncated for brevity.
func DeriveAvatarKey(userID string, salt []byte) string {
    mac := hmac.New(sha256.New, salt)
    _, _ = mac.Write([]byte(userID))
    sum := mac.Sum(nil)
    enc := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(sum)
    if len(enc) > 12 { // keep short but with ample entropy for avatar variations
        enc = enc[:12]
    }
    return enc
}

