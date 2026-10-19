package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	api "github.com/janvillarosa/gracie-app/backend/internal/http"
	"github.com/janvillarosa/gracie-app/backend/internal/services"
)

// AutopilotHandler serves a list's autopilot: suggestions, the run hint, and (later) what it applied.
type AutopilotHandler struct{ svc *services.AutopilotService }

// deprecated marks an answer from a route that is kept at its path until the List page reads
// GET .../autopilot for everything (RFC 9745 Deprecation, RFC 8288 successor link).
func deprecated(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Deprecation", "true")
	w.Header().Set("Link", "</rooms/"+chi.URLParam(r, "room_id")+"/lists/"+chi.URLParam(r, "list_id")+`/autopilot>; rel="successor-version"`)
}

func NewAutopilotHandler(svc *services.AutopilotService) *AutopilotHandler {
	return &AutopilotHandler{svc: svc}
}

// Suggestions handles GET /rooms/{room_id}/lists/{list_id}/suggestions. Deprecated: see deprecated.
func (h *AutopilotHandler) Suggestions(w http.ResponseWriter, r *http.Request) {
	deprecated(w, r)
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	limit := intParam(r, "limit", 1, 1, 5)
	out, err := h.svc.Suggestions(r.Context(), u, chi.URLParam(r, "room_id"), chi.URLParam(r, "list_id"), limit, r.URL.Query().Get("during"))
	if err != nil {
		api.WriteJSON(w, statusFromErr(err), map[string]string{"error": err.Error()})
		return
	}
	api.WriteJSON(w, http.StatusOK, map[string]any{"suggestions": out})
}

type ignoreSuggestionReq struct {
	Key    string `json:"key"`
	During string `json:"during,omitempty"`
}

// Ignore handles POST /rooms/{room_id}/lists/{list_id}/suggestions/ignore {key}. The key is
// in the body, not the path, because it is free text ("2% milk", "a/b"). Deprecated: see deprecated.
func (h *AutopilotHandler) Ignore(w http.ResponseWriter, r *http.Request) {
	deprecated(w, r)
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	var req ignoreSuggestionReq
	if err := api.DecodeJSON(r, &req); err != nil {
		api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	if err := h.svc.Ignore(r.Context(), u, chi.URLParam(r, "room_id"), chi.URLParam(r, "list_id"), req.Key, req.During); err != nil {
		api.WriteJSON(w, statusFromErr(err), map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// RunHint handles GET /rooms/{room_id}/lists/{list_id}/run-hint: the thresholds the List page uses
// to spot a shopping run, learned from this person's and the house's habits. Deprecated: see
// deprecated.
func (h *AutopilotHandler) RunHint(w http.ResponseWriter, r *http.Request) {
	deprecated(w, r)
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	hint, err := h.svc.RunHint(r.Context(), u, chi.URLParam(r, "room_id"), chi.URLParam(r, "list_id"))
	if err != nil {
		api.WriteJSON(w, statusFromErr(err), map[string]string{"error": err.Error()})
		return
	}
	api.WriteJSON(w, http.StatusOK, map[string]any{"run_hint": hint})
}

// View handles GET /rooms/{room_id}/lists/{list_id}/autopilot: the house's mode, what autopilot
// applied to the list lately, and its suggestions. It never applies anything.
func (h *AutopilotHandler) View(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	v, err := h.svc.View(r.Context(), u, chi.URLParam(r, "room_id"), chi.URLParam(r, "list_id"), r.URL.Query().Get("during"))
	if err != nil {
		api.WriteJSON(w, statusFromErr(err), map[string]string{"error": err.Error()})
		return
	}
	api.WriteJSON(w, http.StatusOK, v)
}

// Undo handles POST /rooms/{room_id}/lists/{list_id}/autopilot/{action_id}/undo.
func (h *AutopilotHandler) Undo(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if err := h.svc.Undo(r.Context(), u, chi.URLParam(r, "room_id"), chi.URLParam(r, "list_id"), chi.URLParam(r, "action_id")); err != nil {
		api.WriteJSON(w, statusFromErr(err), map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
