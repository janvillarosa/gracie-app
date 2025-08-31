package crypto

import (
    "crypto/aes"
    "crypto/cipher"
    crand "crypto/rand"
    "encoding/base64"
    "errors"
    "io"
    "os"
)

// LoadOrCreateKey reads a 32-byte key from path or creates it if missing.
// The file is written with 0600 permissions.
func LoadOrCreateKey(path string) ([]byte, error) {
    if b, err := os.ReadFile(path); err == nil && len(b) >= 32 {
        return b[:32], nil
    }
    key := make([]byte, 32)
    if _, err := io.ReadFull(crand.Reader, key); err != nil {
        return nil, err
    }
    if err := os.MkdirAll(dirOf(path), 0o700); err != nil && !errors.Is(err, os.ErrExist) {
        // ignore if cannot create dir; try write anyway
    }
    if err := os.WriteFile(path, key, 0o600); err != nil {
        return nil, err
    }
    return key, nil
}

func dirOf(p string) string {
    for i := len(p) - 1; i >= 0; i-- {
        if p[i] == '/' {
            return p[:i]
        }
    }
    return "."
}

// Encrypt returns base64( nonce || ciphertext ) using AES-256-GCM.
func Encrypt(key, plaintext []byte) (string, error) {
    block, err := aes.NewCipher(key)
    if err != nil { return "", err }
    gcm, err := cipher.NewGCM(block)
    if err != nil { return "", err }
    nonce := make([]byte, gcm.NonceSize())
    if _, err := io.ReadFull(crand.Reader, nonce); err != nil { return "", err }
    ct := gcm.Seal(nil, nonce, plaintext, nil)
    buf := append(nonce, ct...)
    return base64.RawStdEncoding.EncodeToString(buf), nil
}

// Decrypt expects base64(nonce||ciphertext).
func Decrypt(key []byte, b64 string) ([]byte, error) {
    raw, err := base64.RawStdEncoding.DecodeString(b64)
    if err != nil { return nil, err }
    block, err := aes.NewCipher(key)
    if err != nil { return nil, err }
    gcm, err := cipher.NewGCM(block)
    if err != nil { return nil, err }
    ns := gcm.NonceSize()
    if len(raw) < ns { return nil, errors.New("ciphertext too short") }
    nonce, ct := raw[:ns], raw[ns:]
    return gcm.Open(nil, nonce, ct, nil)
}

