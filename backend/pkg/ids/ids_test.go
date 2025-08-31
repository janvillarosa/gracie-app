package ids

import "testing"

func TestNewID(t *testing.T) {
    id := NewID("usr")
    if len(id) == 0 || id[:4] != "usr_" {
        t.Fatalf("unexpected id: %s", id)
    }
}

func TestNewToken(t *testing.T) {
    tok := NewToken()
    if len(tok) < 40 { // base64url(32 bytes) = 43 chars, but check minimal
        t.Fatalf("unexpected token length: %d", len(tok))
    }
}

