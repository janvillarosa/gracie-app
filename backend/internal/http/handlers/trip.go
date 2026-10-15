package handlers

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	api "github.com/janvillarosa/gracie-app/backend/internal/http"
	"github.com/janvillarosa/gracie-app/backend/internal/ratelimit"
	"github.com/janvillarosa/gracie-app/backend/internal/services"
)

const (
	maxSyncBody = 64 << 10
	maxOpsBody  = 1 << 20
)

type TripHandler struct {
	Trips *services.TripService
	rl    *ratelimit.Limiter
}

func NewTripHandler(trips *services.TripService, rl *ratelimit.Limiter) *TripHandler {
	return &TripHandler{Trips: trips, rl: rl}
}

// tripStatus maps service errors to HTTP statuses. Unlike statusFromErr (lists), unknown
// errors are server errors (500), and their text is never sent to the client.
func tripStatus(err error) (int, string) {
	switch {
	case errors.Is(err, derr.ErrUnauthorized):
		return http.StatusUnauthorized, "unauthorized"
	case errors.Is(err, derr.ErrForbidden):
		return http.StatusForbidden, "forbidden"
	case errors.Is(err, derr.ErrNotFound):
		return http.StatusNotFound, "not found"
	case errors.Is(err, derr.ErrConflict):
		return http.StatusConflict, "conflict"
	case errors.Is(err, derr.ErrBadRequest):
		return http.StatusBadRequest, "bad request"
	case errors.Is(err, derr.ErrRateLimited):
		return http.StatusTooManyRequests, "rate limited"
	}
	log.Printf("trips: internal error: %v", err)
	return http.StatusInternalServerError, "internal error"
}

func writeTripErr(w http.ResponseWriter, err error) {
	code, msg := tripStatus(err)
	api.WriteJSON(w, code, map[string]string{"error": msg})
}

// decodeLimited decodes a strict JSON body of at most max bytes. It writes the error
// response itself and returns false on failure.
func decodeLimited(w http.ResponseWriter, r *http.Request, max int64, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, max)
	if err := api.DecodeJSON(r, dst); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			api.WriteJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "request too large"})
		} else {
			api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		}
		return false
	}
	return true
}

func (h *TripHandler) Sync(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if !h.rl.Allow("trips:" + u.UserID) {
		writeTripErr(w, derr.ErrRateLimited)
		return
	}
	var req struct {
		Known map[string]int64 `json:"known"`
	}
	if !decodeLimited(w, r, maxSyncBody, &req) {
		return
	}
	resp, err := h.Trips.Sync(r.Context(), u, chi.URLParam(r, "room_id"), req.Known)
	if err != nil {
		writeTripErr(w, err)
		return
	}
	api.WriteJSON(w, http.StatusOK, resp)
}

func (h *TripHandler) Ops(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if !h.rl.Allow("trips:" + u.UserID) {
		writeTripErr(w, derr.ErrRateLimited)
		return
	}
	var req struct {
		Ops []json.RawMessage `json:"ops"` // strict envelope; each op is decoded on its own
	}
	if !decodeLimited(w, r, maxOpsBody, &req) {
		return
	}
	resp, err := h.Trips.ApplyOps(r.Context(), u, chi.URLParam(r, "room_id"), req.Ops)
	if err != nil {
		writeTripErr(w, err)
		return
	}
	api.WriteJSON(w, http.StatusOK, resp)
}

func (h *TripHandler) PackingList(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	l, err := h.Trips.EnsurePackingList(r.Context(), u, chi.URLParam(r, "room_id"), chi.URLParam(r, "trip_id"))
	if err != nil {
		writeTripErr(w, err)
		return
	}
	api.WriteJSON(w, http.StatusOK, l)
}
