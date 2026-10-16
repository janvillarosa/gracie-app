package handlers

import (
	"net/http"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	api "github.com/janvillarosa/gracie-app/backend/internal/http"
	"github.com/janvillarosa/gracie-app/backend/internal/parse"
	"github.com/janvillarosa/gracie-app/backend/internal/ratelimit"
)

const maxEventsBody = 32 << 10

// EventsHandler ingests behavior events from the app (opens, views, suggestion and
// nudge interactions). Identity and house come from auth, never from the body.
type EventsHandler struct {
	rec analytics.Recorder
	reg *analytics.Registry
	rl  *ratelimit.Limiter
	now func() time.Time
}

func NewEventsHandler(rec analytics.Recorder, reg *analytics.Registry, rl *ratelimit.Limiter) *EventsHandler {
	return &EventsHandler{rec: rec, reg: reg, rl: rl, now: time.Now}
}

type eventsRequest struct {
	Events []analytics.ClientEvent `json:"events"`
}

type eventsResponse struct {
	Accepted int `json:"accepted"`
	Rejected int `json:"rejected"`
}

// Ingest handles POST /events. A bad event is counted and skipped, never failing the batch,
// so one stale client build cannot make a queue of good events retry forever.
func (h *EventsHandler) Ingest(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if !h.rl.Allow("events:" + u.UserID) {
		writeTripErr(w, derr.ErrRateLimited)
		return
	}
	var req eventsRequest
	if !decodeLimited(w, r, maxEventsBody, &req) {
		return
	}
	if len(req.Events) == 0 || len(req.Events) > analytics.MaxClientBatch {
		api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	roomID := ""
	if u.RoomID != nil {
		roomID = *u.RoomID
	}
	now := h.now().UTC()
	var res eventsResponse
	for _, ce := range req.Events {
		if ce.Key != "" {
			ce.Key = parse.NormalizeKey(ce.Key)
		}
		ev, err := h.reg.BuildClient(ce, u.UserID, roomID, now)
		if err != nil {
			res.Rejected++
			continue
		}
		h.rec.Record(r.Context(), ev)
		res.Accepted++
	}
	api.WriteJSON(w, http.StatusOK, res)
}
