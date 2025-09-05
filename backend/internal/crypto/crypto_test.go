package crypto

import (
    "os"
    "path/filepath"
    "testing"
)

func TestLoadOrCreateKeyRoundTrip(t *testing.T) {
    dir := t.TempDir()
    path := filepath.Join(dir, "enc.key")
    k1, err := LoadOrCreateKey(path)
    if err != nil || len(k1) != 32 { t.Fatalf("create key: %v len=%d", err, len(k1)) }
    info, err := os.Stat(path)
    if err != nil { t.Fatalf("stat: %v", err) }
    if info.Mode().Perm()&0o077 != 0 { t.Fatalf("key file should be 0600 or more restrictive: %v", info.Mode()) }
    k2, err := LoadOrCreateKey(path)
    if err != nil { t.Fatalf("load: %v", err) }
    if string(k1) != string(k2) { t.Fatalf("keys differ on reload") }
}

func TestEncryptDecrypt(t *testing.T) {
    key := make([]byte, 32)
    for i := range key { key[i] = byte(i) }
    ct, err := Encrypt(key, []byte("hello"))
    if err != nil || ct == "" { t.Fatalf("encrypt: %v %q", err, ct) }
    pt, err := Decrypt(key, ct)
    if err != nil { t.Fatalf("decrypt: %v", err) }
    if string(pt) != "hello" { t.Fatalf("roundtrip mismatch: %q", string(pt)) }

    // wrong key
    bad := make([]byte, 32)
    for i := range bad { bad[i] = byte(32-i) }
    if _, err := Decrypt(bad, ct); err == nil { t.Fatalf("expected error with wrong key") }

    // malformed input
    if _, err := Decrypt(key, "not-base64"); err == nil { t.Fatalf("expected base64 error") }
}

