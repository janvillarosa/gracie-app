package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	api "github.com/janvillarosa/gracie-app/backend/internal/http"
	"github.com/janvillarosa/gracie-app/backend/internal/services"
)

// SuggestionsHandler serves smart suggestions for one list.
type SuggestionsHandler struct{ svc *services.SuggestionService }

func NewSuggestionsHandler(svc *services.SuggestionService) *SuggestionsHandler {
	return &SuggestionsHandler{svc: svc}
}

// ForList handles GET /rooms/{room_id}/lists/{list_id}/suggestions.
func (h *SuggestionsHandler) ForList(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	limit := intParam(r, "limit", 1, 1, 5)
	out, err := h.svc.ForList(r.Context(), u, chi.URLParam(r, "room_id"), chi.URLParam(r, "list_id"), limit, r.URL.Query().Get("during"))
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
// in the body, not the path, because it is free text ("2% milk", "a/b").
func (h *SuggestionsHandler) Ignore(w http.ResponseWriter, r *http.Request) {
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
// to spot a shopping run, learned from this person's and the house's habits.
func (h *SuggestionsHandler) RunHint(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	hint, err := h.svc.RunHintFor(r.Context(), u, chi.URLParam(r, "room_id"), chi.URLParam(r, "list_id"))
	if err != nil {
		api.WriteJSON(w, statusFromErr(err), map[string]string{"error": err.Error()})
		return
	}
	api.WriteJSON(w, http.StatusOK, map[string]any{"run_hint": hint})
}
