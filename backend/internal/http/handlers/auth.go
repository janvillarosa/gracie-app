package handlers

import (
    "net/http"

    api "github.com/janvillarosa/gracie-app/backend/internal/http"
    derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
    "github.com/janvillarosa/gracie-app/backend/internal/services"
)

type AuthHandler struct {
    Auth *services.AuthService
}

func NewAuthHandler(auth *services.AuthService) *AuthHandler { return &AuthHandler{Auth: auth} }

type registerReq struct {
    Username string `json:"username"`
    Password string `json:"password"`
    Name     string `json:"name"`
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
    var req registerReq
    if err := api.DecodeJSON(r, &req); err != nil || req.Username == "" || req.Password == "" {
        api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
        return
    }
    if err := h.Auth.Register(r.Context(), req.Username, req.Password, req.Name); err != nil {
        code := http.StatusInternalServerError
        if err == derr.ErrConflict { code = http.StatusConflict }
        if err == derr.ErrBadRequest { code = http.StatusBadRequest }
        api.WriteJSON(w, code, map[string]string{"error": err.Error()})
        return
    }
    w.WriteHeader(http.StatusCreated)
}

type loginReq struct {
    Username string `json:"username"`
    Password string `json:"password"`
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
    var req loginReq
    if err := api.DecodeJSON(r, &req); err != nil || req.Username == "" || req.Password == "" {
        api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
        return
    }
    res, err := h.Auth.Login(r.Context(), req.Username, req.Password)
    if err != nil {
        code := http.StatusUnauthorized
        if err == derr.ErrBadRequest { code = http.StatusBadRequest }
        api.WriteJSON(w, code, map[string]string{"error": err.Error()})
        return
    }
    api.WriteJSON(w, http.StatusOK, map[string]any{"user": res.User, "api_key": res.APIKey})
}

