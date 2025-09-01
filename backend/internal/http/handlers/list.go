package handlers

import (
    "net/http"
    "strconv"

    "github.com/go-chi/chi/v5"
    api "github.com/janvillarosa/gracie-app/backend/internal/http"
    derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
    "github.com/janvillarosa/gracie-app/backend/internal/services"
)

type ListHandler struct {
    Lists *services.ListService
}

func NewListHandler(lists *services.ListService) *ListHandler { return &ListHandler{Lists: lists} }

// Lists endpoints
type createListReq struct {
    Name        string `json:"name"`
    Description string `json:"description"`
}

func (h *ListHandler) CreateList(w http.ResponseWriter, r *http.Request) {
    u, ok := api.UserFrom(r.Context())
    if !ok { api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"}); return }
    roomID := chi.URLParam(r, "room_id")
    var req createListReq
    if err := api.DecodeJSON(r, &req); err != nil || req.Name == "" {
        api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"}); return
    }
    l, err := h.Lists.CreateList(r.Context(), u, roomID, req.Name, req.Description)
    if err != nil {
        code := statusFromErr(err)
        api.WriteJSON(w, code, map[string]string{"error": err.Error()}); return
    }
    api.WriteJSON(w, http.StatusCreated, l)
}

func (h *ListHandler) ListLists(w http.ResponseWriter, r *http.Request) {
    u, ok := api.UserFrom(r.Context())
    if !ok { api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"}); return }
    roomID := chi.URLParam(r, "room_id")
    ls, err := h.Lists.ListLists(r.Context(), u, roomID)
    if err != nil { api.WriteJSON(w, statusFromErr(err), map[string]string{"error": err.Error()}); return }
    api.WriteJSON(w, http.StatusOK, ls)
}

func (h *ListHandler) VoteListDeletion(w http.ResponseWriter, r *http.Request) {
    u, ok := api.UserFrom(r.Context())
    if !ok { api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"}); return }
    roomID := chi.URLParam(r, "room_id")
    listID := chi.URLParam(r, "list_id")
    deleted, err := h.Lists.VoteListDeletion(r.Context(), u, roomID, listID)
    if err != nil { api.WriteJSON(w, statusFromErr(err), map[string]string{"error": err.Error()}); return }
    api.WriteJSON(w, http.StatusOK, map[string]bool{"deleted": deleted})
}

func (h *ListHandler) CancelListDeletionVote(w http.ResponseWriter, r *http.Request) {
    u, ok := api.UserFrom(r.Context())
    if !ok { api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"}); return }
    roomID := chi.URLParam(r, "room_id")
    listID := chi.URLParam(r, "list_id")
    if err := h.Lists.CancelListDeletionVote(r.Context(), u, roomID, listID); err != nil {
        api.WriteJSON(w, statusFromErr(err), map[string]string{"error": err.Error()}); return
    }
    w.WriteHeader(http.StatusNoContent)
}

// Items endpoints
type createItemReq struct {
    Description string `json:"description"`
}

func (h *ListHandler) CreateItem(w http.ResponseWriter, r *http.Request) {
    u, ok := api.UserFrom(r.Context())
    if !ok { api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"}); return }
    roomID := chi.URLParam(r, "room_id")
    listID := chi.URLParam(r, "list_id")
    var req createItemReq
    if err := api.DecodeJSON(r, &req); err != nil || req.Description == "" {
        api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"}); return
    }
    it, err := h.Lists.CreateItem(r.Context(), u, roomID, listID, req.Description)
    if err != nil { api.WriteJSON(w, statusFromErr(err), map[string]string{"error": err.Error()}); return }
    api.WriteJSON(w, http.StatusCreated, it)
}

func (h *ListHandler) ListItems(w http.ResponseWriter, r *http.Request) {
    u, ok := api.UserFrom(r.Context())
    if !ok { api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"}); return }
    roomID := chi.URLParam(r, "room_id")
    listID := chi.URLParam(r, "list_id")
    q := r.URL.Query().Get("include_completed")
    includeCompleted := false
    if q != "" {
        b, _ := strconv.ParseBool(q)
        includeCompleted = b
    }
    items, err := h.Lists.ListItems(r.Context(), u, roomID, listID, includeCompleted)
    if err != nil { api.WriteJSON(w, statusFromErr(err), map[string]string{"error": err.Error()}); return }
    api.WriteJSON(w, http.StatusOK, items)
}

type updateItemReq struct {
    Description *string `json:"description"`
    Completed   *bool   `json:"completed"`
}

func (h *ListHandler) UpdateItem(w http.ResponseWriter, r *http.Request) {
    u, ok := api.UserFrom(r.Context())
    if !ok { api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"}); return }
    roomID := chi.URLParam(r, "room_id")
    listID := chi.URLParam(r, "list_id")
    itemID := chi.URLParam(r, "item_id")
    var req updateItemReq
    if err := api.DecodeJSON(r, &req); err != nil || (req.Description == nil && req.Completed == nil) {
        api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"}); return
    }
    it, err := h.Lists.UpdateItem(r.Context(), u, roomID, listID, itemID, req.Description, req.Completed)
    if err != nil { api.WriteJSON(w, statusFromErr(err), map[string]string{"error": err.Error()}); return }
    api.WriteJSON(w, http.StatusOK, it)
}

func (h *ListHandler) DeleteItem(w http.ResponseWriter, r *http.Request) {
    u, ok := api.UserFrom(r.Context())
    if !ok { api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"}); return }
    roomID := chi.URLParam(r, "room_id")
    listID := chi.URLParam(r, "list_id")
    itemID := chi.URLParam(r, "item_id")
    if err := h.Lists.DeleteItem(r.Context(), u, roomID, listID, itemID); err != nil {
        api.WriteJSON(w, statusFromErr(err), map[string]string{"error": err.Error()}); return
    }
    w.WriteHeader(http.StatusNoContent)
}

func statusFromErr(err error) int {
    switch err {
    case derr.ErrUnauthorized:
        return http.StatusUnauthorized
    case derr.ErrForbidden:
        return http.StatusForbidden
    case derr.ErrNotFound:
        return http.StatusNotFound
    case derr.ErrConflict:
        return http.StatusConflict
    case derr.ErrBadRequest:
        return http.StatusBadRequest
    default:
        return http.StatusBadRequest
    }
}

