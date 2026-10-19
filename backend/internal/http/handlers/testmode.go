package handlers

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	api "github.com/janvillarosa/gracie-app/backend/internal/http"
	"github.com/janvillarosa/gracie-app/backend/internal/ratelimit"
	"github.com/janvillarosa/gracie-app/backend/internal/services"
)

// TestModeHandler serves test mode: the actions a test account can trigger.
type TestModeHandler struct {
	svc *services.TestModeService
	rl  *ratelimit.Limiter
}

func NewTestModeHandler(svc *services.TestModeService, rl *ratelimit.Limiter) *TestModeHandler {
	return &TestModeHandler{svc: svc, rl: rl}
}

func notFound(w http.ResponseWriter) {
	api.WriteJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
}

// List handles GET /test/actions. Anyone who is not a test account gets a plain 404.
func (h *TestModeHandler) List(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	out, err := h.svc.List(u)
	if err != nil {
		notFound(w)
		return
	}
	api.WriteJSON(w, http.StatusOK, map[string]any{"actions": out})
}

// Run handles POST /test/actions/{id}: {message} on success, 409 {error} when the action would
// reach a real housemate.
func (h *TestModeHandler) Run(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	// Not a test account: answer exactly like an unknown route, before spending any rate limit.
	if _, err := h.svc.List(u); err != nil {
		notFound(w)
		return
	}
	if !h.rl.Allow("testmode:" + u.UserID) {
		api.WriteJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate limited"})
		return
	}
	msg, err := h.svc.Run(r.Context(), u, chi.URLParam(r, "id"))
	switch {
	case err == nil:
		api.WriteJSON(w, http.StatusOK, map[string]string{"message": msg})
	case errors.Is(err, services.ErrNeedsTestHouse):
		api.WriteJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, derr.ErrNotFound):
		notFound(w)
	case errors.Is(err, derr.ErrBadRequest):
		api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	default:
		// Only a test account sees this, and the reason helps it.
		api.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
}
