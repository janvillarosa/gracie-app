package handlers

import (
	"net/http"
	"strconv"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	api "github.com/janvillarosa/gracie-app/backend/internal/http"
	"github.com/janvillarosa/gracie-app/backend/internal/ratelimit"
	"github.com/janvillarosa/gracie-app/backend/internal/services/places"
)

type PlacesHandler struct {
	svc     *places.Service
	perUser *ratelimit.Limiter
}

func NewPlacesHandler(svc *places.Service, perUser *ratelimit.Limiter) *PlacesHandler {
	return &PlacesHandler{svc: svc, perUser: perUser}
}

func floatParam(r *http.Request, name string) (*float64, bool) {
	s := r.URL.Query().Get(name)
	if s == "" {
		return nil, true
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil, false
	}
	return &v, true
}

func (h *PlacesHandler) Search(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if !h.perUser.Allow("places:" + u.UserID) {
		writeTripErr(w, derr.ErrRateLimited)
		return
	}
	lat, ok1 := floatParam(r, "lat")
	lng, ok2 := floatParam(r, "lng")
	if !ok1 || !ok2 {
		writeTripErr(w, derr.ErrBadRequest)
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	res, err := h.svc.Search(r.Context(), r.URL.Query().Get("q"), lat, lng, r.URL.Query().Get("lang"), limit)
	if err != nil {
		writeTripErr(w, err)
		return
	}
	api.WriteJSON(w, http.StatusOK, res)
}

func (h *PlacesHandler) Reverse(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if !h.perUser.Allow("places:" + u.UserID) {
		writeTripErr(w, derr.ErrRateLimited)
		return
	}
	lat, ok1 := floatParam(r, "lat")
	lng, ok2 := floatParam(r, "lng")
	if !ok1 || !ok2 || lat == nil || lng == nil {
		writeTripErr(w, derr.ErrBadRequest)
		return
	}
	res, err := h.svc.Reverse(r.Context(), *lat, *lng, r.URL.Query().Get("lang"))
	if err != nil {
		writeTripErr(w, err)
		return
	}
	api.WriteJSON(w, http.StatusOK, res)
}
