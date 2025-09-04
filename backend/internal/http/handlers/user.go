package handlers

import (
    "net/http"

    api "github.com/janvillarosa/gracie-app/backend/internal/http"
    "github.com/janvillarosa/gracie-app/backend/internal/services"
    "github.com/janvillarosa/gracie-app/backend/pkg/ids"
)

type UserHandler struct {
    Users      *services.UserService
    AvatarSalt []byte
}

func NewUserHandler(users *services.UserService, avatarSalt []byte) *UserHandler {
    return &UserHandler{Users: users, AvatarSalt: avatarSalt}
}

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
        "username":   u.Username,
        "room_id":    u.RoomID,
        "created_at": u.CreatedAt,
        "updated_at": u.UpdatedAt,
        "avatar_key": ids.DeriveAvatarKey(u.UserID, h.AvatarSalt),
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

type updateProfileReq struct {
    Name     *string `json:"name,omitempty"`
    Username *string `json:"username,omitempty"`
}

// UpdateMePartial supports partial updates of user profile (name/email).
func (h *UserHandler) UpdateMePartial(w http.ResponseWriter, r *http.Request) {
    u, ok := api.UserFrom(r.Context())
    if !ok {
        api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
        return
    }
    var req updateProfileReq
    if err := api.DecodeJSON(r, &req); err != nil || (req.Name == nil && req.Username == nil) {
        api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
        return
    }
    if err := h.Users.UpdateProfile(r.Context(), u.UserID, req.Name, req.Username); err != nil {
        code := http.StatusBadRequest
        if err.Error() == "conflict" { code = http.StatusConflict }
        api.WriteJSON(w, code, map[string]string{"error": err.Error()})
        return
    }
    w.WriteHeader(http.StatusNoContent)
}

type changePasswordReq struct {
    Current string `json:"current_password"`
    Next    string `json:"new_password"`
}


type deleteReq struct {
    Confirm string `json:"confirm"`
}

func (h *UserHandler) DeleteMe(w http.ResponseWriter, r *http.Request) {
    u, ok := api.UserFrom(r.Context())
    if !ok {
        api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
        return
    }
    var req deleteReq
    if err := api.DecodeJSON(r, &req); err != nil || req.Confirm != "DELETE" {
        api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "confirmation required"})
        return
    }
    if err := h.Users.DeleteAccount(r.Context(), u.UserID); err != nil {
        api.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
        return
    }
    w.WriteHeader(http.StatusNoContent)
}
