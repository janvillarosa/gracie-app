package handlers

import (
    "net/http"

    "github.com/go-chi/chi/v5"
    api "github.com/janvillarosa/gracie-app/backend/internal/http"
    derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
    "github.com/janvillarosa/gracie-app/backend/internal/services"
    "github.com/janvillarosa/gracie-app/backend/internal/store"
)

type RoomHandler struct {
    Rooms *services.RoomService
    Users store.UserRepository
}

func NewRoomHandler(rooms *services.RoomService, users store.UserRepository) *RoomHandler { return &RoomHandler{Rooms: rooms, Users: users} }

func (h *RoomHandler) GetMyRoom(w http.ResponseWriter, r *http.Request) {
    u, ok := api.UserFrom(r.Context())
    if !ok {
        api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
        return
    }
    rm, err := h.Rooms.GetMyRoom(r.Context(), u)
    if err != nil {
        code := http.StatusInternalServerError
        if err == derr.ErrNotFound {
            code = http.StatusNotFound
        }
        api.WriteJSON(w, code, map[string]string{"error": err.Error()})
        return
    }
    // Build a view without internal IDs
    members := []string{}
    for _, mid := range rm.MemberIDs {
        if m, err := h.Users.GetByID(r.Context(), mid); err == nil {
            members = append(members, m.Name)
        }
    }
    myVote := false
    if rm.DeletionVotes != nil {
        if _, ok := rm.DeletionVotes[u.UserID]; ok { myVote = true }
    }
    view := map[string]any{
        "display_name": rm.DisplayName,
        "description":  rm.Description,
        "members":      members,
        "created_at":   rm.CreatedAt,
        "updated_at":   rm.UpdatedAt,
        "my_deletion_vote": myVote,
    }
    api.WriteJSON(w, http.StatusOK, view)
}

func (h *RoomHandler) CreateSoloRoom(w http.ResponseWriter, r *http.Request) {
    u, ok := api.UserFrom(r.Context())
    if !ok {
        api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
        return
    }
    rm, err := h.Rooms.CreateSoloRoom(r.Context(), u)
    if err != nil {
        code := http.StatusInternalServerError
        if err == derr.ErrConflict {
            code = http.StatusConflict
        }
        api.WriteJSON(w, code, map[string]string{"error": err.Error()})
        return
    }
    api.WriteJSON(w, http.StatusCreated, rm)
}

func (h *RoomHandler) ShareRoom(w http.ResponseWriter, r *http.Request) {
    u, ok := api.UserFrom(r.Context())
    if !ok {
        api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
        return
    }
    token, err := h.Rooms.RotateShareToken(r.Context(), u)
    if err != nil {
        api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
        return
    }
    // Do not expose internal room_id
    api.WriteJSON(w, http.StatusOK, map[string]string{"token": token})
}

type joinReq struct {
    Token string `json:"token"`
}

func (h *RoomHandler) JoinRoom(w http.ResponseWriter, r *http.Request) {
    u, ok := api.UserFrom(r.Context())
    if !ok {
        api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
        return
    }
    roomID := chi.URLParam(r, "room_id")
    var req joinReq
    if err := api.DecodeJSON(r, &req); err != nil || req.Token == "" {
        api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
        return
    }
    rm, err := h.Rooms.JoinRoom(r.Context(), u, roomID, req.Token)
    if err != nil {
        code := http.StatusBadRequest
        if err == derr.ErrConflict {
            code = http.StatusConflict
        } else if err == derr.ErrForbidden {
            code = http.StatusForbidden
        }
        api.WriteJSON(w, code, map[string]string{"error": err.Error()})
        return
    }
    // Return a sanitized view
    members := []string{}
    for _, mid := range rm.MemberIDs {
        if m, err := h.Users.GetByID(r.Context(), mid); err == nil {
            members = append(members, m.Name)
        }
    }
    api.WriteJSON(w, http.StatusOK, map[string]any{
        "display_name": rm.DisplayName,
        "description":  rm.Description,
        "members":      members,
        "created_at":   rm.CreatedAt,
        "updated_at":   rm.UpdatedAt,
    })
}

// Join using only a token (no room_id exposed)
func (h *RoomHandler) JoinByToken(w http.ResponseWriter, r *http.Request) {
    u, ok := api.UserFrom(r.Context())
    if !ok {
        api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
        return
    }
    var req joinReq
    if err := api.DecodeJSON(r, &req); err != nil || req.Token == "" {
        api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
        return
    }
    rm, err := h.Rooms.JoinRoomByToken(r.Context(), u, req.Token)
    if err != nil {
        code := http.StatusBadRequest
        if err == derr.ErrConflict { code = http.StatusConflict }
        if err == derr.ErrForbidden { code = http.StatusForbidden }
        if err == derr.ErrNotFound { code = http.StatusNotFound }
        api.WriteJSON(w, code, map[string]string{"error": err.Error()})
        return
    }
    members := []string{}
    for _, mid := range rm.MemberIDs {
        if m, err := h.Users.GetByID(r.Context(), mid); err == nil {
            members = append(members, m.Name)
        }
    }
    api.WriteJSON(w, http.StatusOK, map[string]any{
        "display_name": rm.DisplayName,
        "description":  rm.Description,
        "members":      members,
        "created_at":   rm.CreatedAt,
        "updated_at":   rm.UpdatedAt,
    })
}

func (h *RoomHandler) VoteDeletion(w http.ResponseWriter, r *http.Request) {
    u, ok := api.UserFrom(r.Context())
    if !ok {
        api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
        return
    }
    deleted, err := h.Rooms.VoteDeletion(r.Context(), u)
    if err != nil {
        api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
        return
    }
    api.WriteJSON(w, http.StatusOK, map[string]bool{"deleted": deleted})
}

func (h *RoomHandler) CancelDeletion(w http.ResponseWriter, r *http.Request) {
    u, ok := api.UserFrom(r.Context())
    if !ok {
        api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
        return
    }
    if err := h.Rooms.CancelDeletionVote(r.Context(), u); err != nil {
        api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
        return
    }
    w.WriteHeader(http.StatusNoContent)
}

type updateSettingsReq struct {
    DisplayName *string `json:"display_name"`
    Description *string `json:"description"`
}

func (h *RoomHandler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
    u, ok := api.UserFrom(r.Context())
    if !ok {
        api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
        return
    }
    var req updateSettingsReq
    if err := api.DecodeJSON(r, &req); err != nil {
        api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
        return
    }
    // Validate display name: alphanumeric + spaces, 1-64
    if req.DisplayName != nil {
        dn := *req.DisplayName
        if len(dn) == 0 || len(dn) > 64 {
            api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid display name"})
            return
        }
        for _, c := range dn {
            if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == ' ' {
                continue
            }
            api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "display name must be alphanumeric with spaces"})
            return
        }
    }
    // Description: allow up to 512 chars; empty string removes
    if req.Description != nil && len(*req.Description) > 512 {
        api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "description too long"})
        return
    }
    if req.DisplayName == nil && req.Description == nil {
        w.WriteHeader(http.StatusNoContent)
        return
    }
    if err := h.Rooms.UpdateRoomSettings(r.Context(), u, req.DisplayName, req.Description); err != nil {
        code := http.StatusBadRequest
        if err == derr.ErrNotFound { code = http.StatusNotFound }
        if err == derr.ErrForbidden { code = http.StatusForbidden }
        api.WriteJSON(w, code, map[string]string{"error": err.Error()})
        return
    }
    // Return sanitized, updated view
    rm, err := h.Rooms.GetMyRoom(r.Context(), u)
    if err != nil {
        api.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
        return
    }
    members := []string{}
    for _, mid := range rm.MemberIDs {
        if m, err := h.Users.GetByID(r.Context(), mid); err == nil {
            members = append(members, m.Name)
        }
    }
    api.WriteJSON(w, http.StatusOK, map[string]any{
        "display_name": rm.DisplayName,
        "description":  rm.Description,
        "members":      members,
        "created_at":   rm.CreatedAt,
        "updated_at":   rm.UpdatedAt,
    })
}
