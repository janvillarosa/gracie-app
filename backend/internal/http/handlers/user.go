package handlers

import (
    "net/http"

    api "github.com/janvillarosa/gracie-app/backend/internal/http"
    "github.com/janvillarosa/gracie-app/backend/internal/services"
)

type UserHandler struct {
    Users *services.UserService
}

func NewUserHandler(users *services.UserService) *UserHandler { return &UserHandler{Users: users} }

type createUserReq struct {
    Name string `json:"name"`
}
type createUserResp struct {
    User   interface{} `json:"user"`
    APIKey string      `json:"api_key"`
}

func (h *UserHandler) CreateUser(w http.ResponseWriter, r *http.Request) {
    var req createUserReq
    if err := api.DecodeJSON(r, &req); err != nil || req.Name == "" {
        api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
        return
    }
    cu, err := h.Users.CreateUserWithSoloRoom(r.Context(), req.Name)
    if err != nil {
        api.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
        return
    }
    // Hide secrets in user payload
    respUser := map[string]interface{}{
        "user_id":    cu.User.UserID,
        "name":       cu.User.Name,
        "room_id":    cu.User.RoomID,
        "created_at": cu.User.CreatedAt,
        "updated_at": cu.User.UpdatedAt,
    }
    api.WriteJSON(w, http.StatusCreated, createUserResp{User: respUser, APIKey: cu.APIKey})
}

func (h *UserHandler) GetMe(w http.ResponseWriter, r *http.Request) {
    u, ok := api.UserFrom(r.Context())
    if !ok {
        api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
        return
    }
    respUser := map[string]interface{}{
        "user_id":    u.UserID,
        "name":       u.Name,
        "room_id":    u.RoomID,
        "created_at": u.CreatedAt,
        "updated_at": u.UpdatedAt,
    }
    api.WriteJSON(w, http.StatusOK, respUser)
}

func (h *UserHandler) UpdateMe(w http.ResponseWriter, r *http.Request) {
    u, ok := api.UserFrom(r.Context())
    if !ok {
        api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
        return
    }
    var req createUserReq
    if err := api.DecodeJSON(r, &req); err != nil || req.Name == "" {
        api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
        return
    }
    if err := h.Users.UpdateName(r.Context(), u.UserID, req.Name); err != nil {
        api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
        return
    }
    w.WriteHeader(http.StatusNoContent)
}
