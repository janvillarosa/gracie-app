package handlers_test

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
    "net/http/httptest"
    "testing"

    "github.com/janvillarosa/gracie-app/backend/internal/http/router"
    handlers "github.com/janvillarosa/gracie-app/backend/internal/http/handlers"
    "github.com/janvillarosa/gracie-app/backend/internal/services"
    "github.com/janvillarosa/gracie-app/backend/internal/store/dynamo"
    "github.com/janvillarosa/gracie-app/backend/internal/testutil"
)

func TestHTTPFlow(t *testing.T) {
    db, usersTable, roomsTable, cleanup := testutil.SetupDynamoOrSkip(t)
    defer cleanup()
    client := &dynamo.Client{DB: db, Tables: dynamo.Tables{Users: usersTable, Rooms: roomsTable}}

    usersRepo := dynamo.NewUserRepo(client)
    roomsRepo := dynamo.NewRoomRepo(client)
    userSvc := services.NewUserService(client, usersRepo)
    roomSvc := services.NewRoomService(client, usersRepo, roomsRepo)
    authSvc, err := services.NewAuthService(client, usersRepo, "/tmp/gracie-test-enc.key")
    if err != nil { t.Fatalf("auth svc: %v", err) }

    ah := handlers.NewAuthHandler(authSvc)
    uh := handlers.NewUserHandler(userSvc)
    rh := handlers.NewRoomHandler(roomSvc)
    r := router.NewRouter(usersRepo, ah, uh, rh)

    srv := httptest.NewServer(r)
    defer srv.Close()

    // Create user A
    aResp := struct{ User struct{ UserID, Name, CreatedAt, UpdatedAt string; RoomID *string `json:"room_id"` }; APIKey string `json:"api_key"` }{}
    postJSON(t, srv.URL+"/users", map[string]string{"name": "Alice"}, &aResp, http.StatusCreated)
    if aResp.APIKey == "" || aResp.User.RoomID == nil { t.Fatalf("signup A failed") }

    // Get me
    var me map[string]any
    getAuthJSON(t, srv.URL+"/me", aResp.APIKey, &me, http.StatusOK)

    // Share
    share := struct{ RoomID string `json:"room_id"`; Token string `json:"token"` }{}
    postAuthJSON(t, srv.URL+"/rooms/share", aResp.APIKey, nil, &share, http.StatusOK)
    if share.RoomID == "" || share.Token == "" { t.Fatalf("share failed") }

    // Create user B and join
    bResp := struct{ User struct{ UserID string; RoomID *string }; APIKey string `json:"api_key"` }{}
    postJSON(t, srv.URL+"/users", map[string]string{"name": "Bob"}, &bResp, http.StatusCreated)

    // Join request by B
    joinReq := map[string]string{"token": share.Token}
    var joined map[string]any
    postAuthJSON(t, fmt.Sprintf("%s/rooms/%s/join", srv.URL, share.RoomID), bResp.APIKey, joinReq, &joined, http.StatusOK)

    // Vote deletion by both
    var del struct{ Deleted bool }
    postAuthJSON(t, srv.URL+"/rooms/deletion/vote", aResp.APIKey, nil, &del, http.StatusOK)
    postAuthJSON(t, srv.URL+"/rooms/deletion/vote", bResp.APIKey, nil, &del, http.StatusOK)
    if !del.Deleted { t.Fatalf("expected deleted true on second vote") }
}

// Helpers
func postJSON[T any](t *testing.T, url string, body any, out *T, want int) {
    t.Helper()
    var buf bytes.Buffer
    if body != nil { _ = json.NewEncoder(&buf).Encode(body) }
    req, _ := http.NewRequest("POST", url, &buf)
    req.Header.Set("Content-Type", "application/json")
    resp, err := http.DefaultClient.Do(req)
    if err != nil { t.Fatalf("post %s: %v", url, err) }
    defer resp.Body.Close()
    if resp.StatusCode != want { t.Fatalf("want %d got %d", want, resp.StatusCode) }
    if out != nil { _ = json.NewDecoder(resp.Body).Decode(out) }
}

func postAuthJSON[T any](t *testing.T, url string, apiKey string, body any, out *T, want int) {
    t.Helper()
    var buf bytes.Buffer
    if body != nil { _ = json.NewEncoder(&buf).Encode(body) }
    req, _ := http.NewRequest("POST", url, &buf)
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("Authorization", "Bearer "+apiKey)
    resp, err := http.DefaultClient.Do(req)
    if err != nil { t.Fatalf("post %s: %v", url, err) }
    defer resp.Body.Close()
    if resp.StatusCode != want { t.Fatalf("want %d got %d", want, resp.StatusCode) }
    if out != nil { _ = json.NewDecoder(resp.Body).Decode(out) }
}

func getAuthJSON[T any](t *testing.T, url, apiKey string, out *T, want int) {
    t.Helper()
    req, _ := http.NewRequest("GET", url, nil)
    req.Header.Set("Authorization", "Bearer "+apiKey)
    resp, err := http.DefaultClient.Do(req)
    if err != nil { t.Fatalf("get %s: %v", url, err) }
    defer resp.Body.Close()
    if resp.StatusCode != want { t.Fatalf("want %d got %d", want, resp.StatusCode) }
    if out != nil { _ = json.NewDecoder(resp.Body).Decode(out) }
}
