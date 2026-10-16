package handlers

import (
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	api "github.com/janvillarosa/gracie-app/backend/internal/http"
	"github.com/janvillarosa/gracie-app/backend/internal/services"
)

var reSubject = regexp.MustCompile(`^[a-z_]{1,32}$`)

// InsightsHandler serves read-only behavior insights. Raw events are never returned.
type InsightsHandler struct{ svc *services.InsightsService }

func NewInsightsHandler(svc *services.InsightsService) *InsightsHandler {
	return &InsightsHandler{svc: svc}
}

func intParam(r *http.Request, name string, def, min, max int) int {
	n, err := strconv.Atoi(r.URL.Query().Get(name))
	if err != nil || n < min {
		return def
	}
	if n > max {
		return max
	}
	return n
}

// Mine handles GET /me/insights: the caller's own profile.
func (h *InsightsHandler) Mine(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	p, err := h.svc.MyInsights(r.Context(), u)
	if err != nil {
		writeTripErr(w, err)
		return
	}
	api.WriteJSON(w, http.StatusOK, map[string]any{"profile": p})
}

// House handles GET /rooms/{room_id}/insights?subject=item&within_days=3&limit=20.
func (h *InsightsHandler) House(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	subject := r.URL.Query().Get("subject")
	if subject == "" {
		subject = "item"
	}
	if !reSubject.MatchString(subject) {
		api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	within := time.Duration(intParam(r, "within_days", 3, 0, 30)) * 24 * time.Hour
	out, err := h.svc.HouseInsights(r.Context(), u, chi.URLParam(r, "room_id"), subject, within, intParam(r, "limit", 20, 1, 50))
	if err != nil {
		writeTripErr(w, err)
		return
	}
	api.WriteJSON(w, http.StatusOK, out)
}

// HousePeriod handles GET /rooms/{room_id}/insights/periods/{period}.
func (h *InsightsHandler) HousePeriod(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	doc, err := h.svc.HousePeriod(r.Context(), u, chi.URLParam(r, "room_id"), chi.URLParam(r, "period"))
	if err != nil {
		writeTripErr(w, err)
		return
	}
	api.WriteJSON(w, http.StatusOK, doc)
}
