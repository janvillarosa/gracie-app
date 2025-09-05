package handlers_test

import (
    "bytes"
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "testing"

    handlers "github.com/janvillarosa/gracie-app/backend/internal/http/handlers"
    "github.com/janvillarosa/gracie-app/backend/internal/http/router"
    "github.com/janvillarosa/gracie-app/backend/internal/services"
    "github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

func TestHTTPFlow(t *testing.T) {
    tx, usersRepo, roomsRepo, listsRepo, itemsRepo := memstore.Compose()
    userSvc := services.NewUserService(usersRepo, roomsRepo, tx)
    roomSvc := services.NewRoomService(usersRepo, roomsRepo, tx)
    listSvc := services.NewListService(usersRepo, roomsRepo, listsRepo, itemsRepo)
    authSvc, err := services.NewAuthService(usersRepo, "/tmp/gracie-test-enc.key", 720)
    if err != nil { t.Fatalf("auth svc: %v", err) }

    ah := handlers.NewAuthHandler(authSvc)
    uh := handlers.NewUserHandler(userSvc, []byte("salt"))
    rh := handlers.NewRoomHandler(roomSvc, usersRepo, []byte("salt"))
    lh := handlers.NewListHandler(listSvc)
    r := router.NewRouter(usersRepo, ah, uh, rh, lh)

    // Create user A
    aResp := struct{ User struct{ UserID, Name, CreatedAt, UpdatedAt string; RoomID *string `json:"room_id"` }; APIKey string `json:"api_key"` }{}
    doPostJSON(t, r, "/users", map[string]string{"name": "Alice"}, &aResp, http.StatusCreated)
    if aResp.APIKey == "" || aResp.User.RoomID == nil { t.Fatalf("signup A failed") }

    // Get me
    var me map[string]any
    doGetAuthJSON(t, r, "/me", aResp.APIKey, &me, http.StatusOK)

    // Share
    share := struct{ Token string `json:"token"` }{}
    doPostAuthJSON(t, r, "/rooms/share", aResp.APIKey, nil, &share, http.StatusOK)
    if share.Token == "" { t.Fatalf("share failed") }

    // Create user B and join
    bResp := struct{ User struct{ UserID string; RoomID *string }; APIKey string `json:"api_key"` }{}
    doPostJSON(t, r, "/users", map[string]string{"name": "Bob"}, &bResp, http.StatusCreated)

    // Join request by B via token only
    joinReq := map[string]string{"token": share.Token}
    var joined map[string]any
    doPostAuthJSON(t, r, "/rooms/join", bResp.APIKey, joinReq, &joined, http.StatusOK)

    // Vote deletion by both
    var del struct{ Deleted bool }
    doPostAuthJSON(t, r, "/rooms/deletion/vote", aResp.APIKey, nil, &del, http.StatusOK)
    doPostAuthJSON(t, r, "/rooms/deletion/vote", bResp.APIKey, nil, &del, http.StatusOK)
    if !del.Deleted { t.Fatalf("expected deleted true on second vote") }
}

// Helpers using in-process router.ServeHTTP (no network)
func doPostJSON[T any](t *testing.T, h http.Handler, path string, body any, out *T, want int) {
    t.Helper()
    var buf bytes.Buffer
    if body != nil { _ = json.NewEncoder(&buf).Encode(body) }
    req, _ := http.NewRequest("POST", path, &buf)
    req.Header.Set("Content-Type", "application/json")
    rr := httptest.NewRecorder()
    h.ServeHTTP(rr, req)
    if rr.Code != want { t.Fatalf("%s %s: want %d got %d", req.Method, path, want, rr.Code) }
    if out != nil { _ = json.NewDecoder(rr.Body).Decode(out) }
}

func doPostAuthJSON[T any](t *testing.T, h http.Handler, path, apiKey string, body any, out *T, want int) {
    t.Helper()
    var buf bytes.Buffer
    if body != nil { _ = json.NewEncoder(&buf).Encode(body) }
    req, _ := http.NewRequest("POST", path, &buf)
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("Authorization", "Bearer "+apiKey)
    rr := httptest.NewRecorder()
    h.ServeHTTP(rr, req)
    if rr.Code != want { t.Fatalf("%s %s: want %d got %d", req.Method, path, want, rr.Code) }
    if out != nil { _ = json.NewDecoder(rr.Body).Decode(out) }
}

func doGetAuthJSON[T any](t *testing.T, h http.Handler, path, apiKey string, out *T, want int) {
    t.Helper()
    req, _ := http.NewRequest("GET", path, nil)
    req.Header.Set("Authorization", "Bearer "+apiKey)
    rr := httptest.NewRecorder()
    h.ServeHTTP(rr, req)
    if rr.Code != want { t.Fatalf("%s %s: want %d got %d", req.Method, path, want, rr.Code) }
    if out != nil { _ = json.NewDecoder(rr.Body).Decode(out) }
}
