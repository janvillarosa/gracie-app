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

func TestListsFlow(t *testing.T) {
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

    // Create user A and B; B joins A via token
    aResp := struct{ User struct{ UserID string; RoomID *string }; APIKey string `json:"api_key"` }{}
    postJSONLocal(t, r, "/users", map[string]string{"name": "Alice"}, &aResp, http.StatusCreated)
    if aResp.APIKey == "" { t.Fatalf("signup A failed: missing api key") }
    me := struct{ RoomID *string `json:"room_id"` }{}
    getAuthJSONLocal(t, r, "/me", aResp.APIKey, &me, http.StatusOK)
    if me.RoomID == nil { t.Fatalf("signup A failed: missing room id from /me") }
    share := struct{ Token string `json:"token"` }{}
    postAuthJSONLocal(t, r, "/rooms/share", aResp.APIKey, nil, &share, http.StatusOK)
    bResp := struct{ User struct{ UserID string; RoomID *string }; APIKey string `json:"api_key"` }{}
    postJSONLocal(t, r, "/users", map[string]string{"name": "Bob"}, &bResp, http.StatusCreated)
    postAuthJSONLocal(t, r, "/rooms/join", bResp.APIKey, map[string]string{"token": share.Token}, &struct{}{}, http.StatusOK)

    roomID := *me.RoomID

    // Create a list
    list := struct{ ListID string `json:"list_id"`; RoomID string `json:"room_id"`; Name string `json:"name"` }{}
    postAuthJSONLocal(t, r, "/rooms/"+roomID+"/lists", aResp.APIKey, map[string]string{"name": "Groceries", "description": "Weekly"}, &list, http.StatusCreated)
    if list.ListID == "" { t.Fatalf("expected list created") }

    // Create two items
    item1 := struct{ ItemID string `json:"item_id"` }{}
    item2 := struct{ ItemID string `json:"item_id"` }{}
    postAuthJSONLocal(t, r, "/rooms/"+roomID+"/lists/"+list.ListID+"/items", aResp.APIKey, map[string]string{"description": "Milk"}, &item1, http.StatusCreated)
    postAuthJSONLocal(t, r, "/rooms/"+roomID+"/lists/"+list.ListID+"/items", aResp.APIKey, map[string]string{"description": "Bread"}, &item2, http.StatusCreated)

    // Toggle completion on item1
    updated := struct{ ItemID string; Completed bool }{}
    patchAuthJSONLocal(t, r, "/rooms/"+roomID+"/lists/"+list.ListID+"/items/"+item1.ItemID, aResp.APIKey, map[string]any{"completed": true}, &updated, http.StatusOK)
    if !updated.Completed { t.Fatalf("expected item1 completed") }

    // List items without completed => should only include item2
    var items []map[string]any
    getAuthJSONLocal(t, r, "/rooms/"+roomID+"/lists/"+list.ListID+"/items?include_completed=false", aResp.APIKey, &items, http.StatusOK)
    if len(items) != 1 { t.Fatalf("expected 1 incomplete item, got %d", len(items)) }

    // Delete item2
    delReq, _ := http.NewRequest("DELETE", "/rooms/"+roomID+"/lists/"+list.ListID+"/items/"+item2.ItemID, nil)
    delReq.Header.Set("Authorization", "Bearer "+aResp.APIKey)
    rr := httptest.NewRecorder()
    r.ServeHTTP(rr, delReq)
    if rr.Code != http.StatusNoContent { t.Fatalf("expected 204, got %d", rr.Code) }

    // List items include completed => should only include item1
    items = nil
    getAuthJSONLocal(t, r, "/rooms/"+roomID+"/lists/"+list.ListID+"/items?include_completed=true", aResp.APIKey, &items, http.StatusOK)
    if len(items) != 1 { t.Fatalf("expected 1 item after deletion, got %d", len(items)) }

    // Vote list deletion by both members
    var ldel struct{ Deleted bool }
    postAuthJSONLocal(t, r, "/rooms/"+roomID+"/lists/"+list.ListID+"/deletion/vote", aResp.APIKey, nil, &ldel, http.StatusOK)
    postAuthJSONLocal(t, r, "/rooms/"+roomID+"/lists/"+list.ListID+"/deletion/vote", bResp.APIKey, nil, &ldel, http.StatusOK)
    if !ldel.Deleted { t.Fatalf("expected list deleted after both votes") }

    // Lists listing should exclude deleted lists
    var lists []map[string]any
    getAuthJSONLocal(t, r, "/rooms/"+roomID+"/lists", aResp.APIKey, &lists, http.StatusOK)
    if len(lists) != 0 { t.Fatalf("expected 0 lists after deletion, got %d", len(lists)) }
}

// local helper for PATCH authenticated JSON
func postJSONLocal[T any](t *testing.T, h http.Handler, path string, body any, out *T, want int) {
    t.Helper()
    var buf bytes.Buffer
    if body != nil { _ = json.NewEncoder(&buf).Encode(body) }
    req, _ := http.NewRequest("POST", path, &buf)
    req.Header.Set("Content-Type", "application/json")
    rr := httptest.NewRecorder()
    h.ServeHTTP(rr, req)
    if rr.Code != want { t.Fatalf("want %d got %d", want, rr.Code) }
    if out != nil { _ = json.NewDecoder(rr.Body).Decode(out) }
}

func postAuthJSONLocal[T any](t *testing.T, h http.Handler, path, apiKey string, body any, out *T, want int) {
    t.Helper()
    var buf bytes.Buffer
    if body != nil { _ = json.NewEncoder(&buf).Encode(body) }
    req, _ := http.NewRequest("POST", path, &buf)
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("Authorization", "Bearer "+apiKey)
    rr := httptest.NewRecorder()
    h.ServeHTTP(rr, req)
    if rr.Code != want { t.Fatalf("want %d got %d", want, rr.Code) }
    if out != nil { _ = json.NewDecoder(rr.Body).Decode(out) }
}

func patchAuthJSONLocal[T any](t *testing.T, h http.Handler, path, apiKey string, body any, out *T, want int) {
    t.Helper()
    var buf bytes.Buffer
    if body != nil { _ = json.NewEncoder(&buf).Encode(body) }
    req, _ := http.NewRequest("PATCH", path, &buf)
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("Authorization", "Bearer "+apiKey)
    rr := httptest.NewRecorder()
    h.ServeHTTP(rr, req)
    if rr.Code != want { t.Fatalf("want %d got %d", want, rr.Code) }
    if out != nil { _ = json.NewDecoder(rr.Body).Decode(out) }
}

func getAuthJSONLocal[T any](t *testing.T, h http.Handler, path, apiKey string, out *T, want int) {
    t.Helper()
    req, _ := http.NewRequest("GET", path, nil)
    req.Header.Set("Authorization", "Bearer "+apiKey)
    rr := httptest.NewRecorder()
    h.ServeHTTP(rr, req)
    if rr.Code != want { t.Fatalf("want %d got %d", want, rr.Code) }
    if out != nil { _ = json.NewDecoder(rr.Body).Decode(out) }
}
