package api

import (
    "bytes"
    "encoding/json"
    "net/http/httptest"
    "testing"
)

func TestWriteJSONAndDecodeJSON(t *testing.T) {
    rr := httptest.NewRecorder()
    WriteJSON(rr, 201, map[string]string{"ok": "yes"})
    if ct := rr.Header().Get("Content-Type"); ct != "application/json" { t.Fatalf("content-type not set: %q", ct) }
    if rr.Code != 201 { t.Fatalf("status: %d", rr.Code) }

    var dst map[string]string
    req := httptest.NewRequest("POST", "/", bytes.NewBufferString(`{"a":1}`))
    if err := DecodeJSON(req, &dst); err == nil { t.Fatalf("expected error on unknown fields") }

    req2 := httptest.NewRequest("POST", "/", bytes.NewBuffer(mustJSON(map[string]string{"name":"A"})))
    var dst2 map[string]string
    if err := DecodeJSON(req2, &dst2); err != nil || dst2["name"] != "A" { t.Fatalf("decode: %v %v", err, dst2) }
}

func mustJSON(v any) []byte {
    b, _ := json.Marshal(v)
    return b
}

