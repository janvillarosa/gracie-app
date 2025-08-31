package api

import (
    "encoding/json"
    "net/http"
)

func WriteJSON(w http.ResponseWriter, code int, v interface{}) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(code)
    _ = json.NewEncoder(w).Encode(v)
}

func DecodeJSON(r *http.Request, dst interface{}) error {
    dec := json.NewDecoder(r.Body)
    dec.DisallowUnknownFields()
    return dec.Decode(dst)
}
