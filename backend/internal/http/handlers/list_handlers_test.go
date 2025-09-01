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
    "github.com/janvillarosa/gracie-app/backend/internal/store/dynamo"
    "github.com/janvillarosa/gracie-app/backend/internal/testutil"
)

func TestListsFlow(t *testing.T) {
    db, usersTable, roomsTable, listsTable, listItemsTable, cleanup := testutil.SetupDynamoWithListsOrSkip(t)
    defer cleanup()
    client := &dynamo.Client{DB: db, Tables: dynamo.Tables{Users: usersTable, Rooms: roomsTable, Lists: listsTable, ListItems: listItemsTable}}

    usersRepo := dynamo.NewUserRepo(client)
    roomsRepo := dynamo.NewRoomRepo(client)
    listsRepo := dynamo.NewListRepo(client)
    itemsRepo := dynamo.NewListItemRepo(client)

    userSvc := services.NewUserService(client, usersRepo)
    roomSvc := services.NewRoomService(client, usersRepo, roomsRepo)
    listSvc := services.NewListService(client, usersRepo, roomsRepo, listsRepo, itemsRepo)
    authSvc, err := services.NewAuthService(client, usersRepo, "/tmp/gracie-test-enc.key", 720)
    if err != nil { t.Fatalf("auth svc: %v", err) }

    ah := handlers.NewAuthHandler(authSvc)
    uh := handlers.NewUserHandler(userSvc)
    rh := handlers.NewRoomHandler(roomSvc, usersRepo)
    lh := handlers.NewListHandler(listSvc)
    r := router.NewRouter(usersRepo, ah, uh, rh, lh)

    srv := httptest.NewServer(r)
    defer srv.Close()

    // Create user A and B; B joins A via token
    aResp := struct{ User struct{ UserID string; RoomID *string }; APIKey string `json:"api_key"` }{}
    postJSON(t, srv.URL+"/users", map[string]string{"name": "Alice"}, &aResp, http.StatusCreated)
    if aResp.APIKey == "" { t.Fatalf("signup A failed: missing api key") }
    me := struct{ RoomID *string `json:"room_id"` }{}
    getAuthJSON(t, srv.URL+"/me", aResp.APIKey, &me, http.StatusOK)
    if me.RoomID == nil { t.Fatalf("signup A failed: missing room id from /me") }
    share := struct{ Token string `json:"token"` }{}
    postAuthJSON(t, srv.URL+"/rooms/share", aResp.APIKey, nil, &share, http.StatusOK)
    bResp := struct{ User struct{ UserID string; RoomID *string }; APIKey string `json:"api_key"` }{}
    postJSON(t, srv.URL+"/users", map[string]string{"name": "Bob"}, &bResp, http.StatusCreated)
    postAuthJSON(t, srv.URL+"/rooms/join", bResp.APIKey, map[string]string{"token": share.Token}, &struct{}{}, http.StatusOK)

    roomID := *me.RoomID

    // Create a list
    list := struct{ ListID string `json:"list_id"`; RoomID string `json:"room_id"`; Name string `json:"name"` }{}
    postAuthJSON(t, srv.URL+"/rooms/"+roomID+"/lists", aResp.APIKey, map[string]string{"name": "Groceries", "description": "Weekly"}, &list, http.StatusCreated)
    if list.ListID == "" { t.Fatalf("expected list created") }

    // Create two items
    item1 := struct{ ItemID string `json:"item_id"` }{}
    item2 := struct{ ItemID string `json:"item_id"` }{}
    postAuthJSON(t, srv.URL+"/rooms/"+roomID+"/lists/"+list.ListID+"/items", aResp.APIKey, map[string]string{"description": "Milk"}, &item1, http.StatusCreated)
    postAuthJSON(t, srv.URL+"/rooms/"+roomID+"/lists/"+list.ListID+"/items", aResp.APIKey, map[string]string{"description": "Bread"}, &item2, http.StatusCreated)

    // Toggle completion on item1
    updated := struct{ ItemID string; Completed bool }{}
    patchAuthJSON(t, srv.URL+"/rooms/"+roomID+"/lists/"+list.ListID+"/items/"+item1.ItemID, aResp.APIKey, map[string]any{"completed": true}, &updated, http.StatusOK)
    if !updated.Completed { t.Fatalf("expected item1 completed") }

    // List items without completed => should only include item2
    var items []map[string]any
    getAuthJSON(t, srv.URL+"/rooms/"+roomID+"/lists/"+list.ListID+"/items?include_completed=false", aResp.APIKey, &items, http.StatusOK)
    if len(items) != 1 { t.Fatalf("expected 1 incomplete item, got %d", len(items)) }

    // Delete item2
    delReq, _ := http.NewRequest("DELETE", srv.URL+"/rooms/"+roomID+"/lists/"+list.ListID+"/items/"+item2.ItemID, nil)
    delReq.Header.Set("Authorization", "Bearer "+aResp.APIKey)
    resp, err := http.DefaultClient.Do(delReq)
    if err != nil { t.Fatalf("delete item2: %v", err) }
    resp.Body.Close()
    if resp.StatusCode != http.StatusNoContent { t.Fatalf("expected 204, got %d", resp.StatusCode) }

    // List items include completed => should only include item1
    items = nil
    getAuthJSON(t, srv.URL+"/rooms/"+roomID+"/lists/"+list.ListID+"/items?include_completed=true", aResp.APIKey, &items, http.StatusOK)
    if len(items) != 1 { t.Fatalf("expected 1 item after deletion, got %d", len(items)) }

    // Vote list deletion by both members
    var ldel struct{ Deleted bool }
    postAuthJSON(t, srv.URL+"/rooms/"+roomID+"/lists/"+list.ListID+"/deletion/vote", aResp.APIKey, nil, &ldel, http.StatusOK)
    postAuthJSON(t, srv.URL+"/rooms/"+roomID+"/lists/"+list.ListID+"/deletion/vote", bResp.APIKey, nil, &ldel, http.StatusOK)
    if !ldel.Deleted { t.Fatalf("expected list deleted after both votes") }

    // Lists listing should exclude deleted lists
    var lists []map[string]any
    getAuthJSON(t, srv.URL+"/rooms/"+roomID+"/lists", aResp.APIKey, &lists, http.StatusOK)
    if len(lists) != 0 { t.Fatalf("expected 0 lists after deletion, got %d", len(lists)) }
}

// local helper for PATCH authenticated JSON
func patchAuthJSON[T any](t *testing.T, url, apiKey string, body any, out *T, want int) {
    t.Helper()
    var buf bytes.Buffer
    if body != nil { _ = json.NewEncoder(&buf).Encode(body) }
    req, _ := http.NewRequest("PATCH", url, &buf)
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("Authorization", "Bearer "+apiKey)
    resp, err := http.DefaultClient.Do(req)
    if err != nil { t.Fatalf("patch %s: %v", url, err) }
    defer resp.Body.Close()
    if resp.StatusCode != want { t.Fatalf("want %d got %d", want, resp.StatusCode) }
    if out != nil { _ = json.NewDecoder(resp.Body).Decode(out) }
}
