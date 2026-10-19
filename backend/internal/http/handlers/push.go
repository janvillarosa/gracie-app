package handlers

import (
	"net/http"

	api "github.com/janvillarosa/gracie-app/backend/internal/http"
	"github.com/janvillarosa/gracie-app/backend/internal/services"
)

// maxPushBody caps a subscription body (the endpoint alone is at most 1 KB).
const maxPushBody = 4 << 10

// PushHandler serves push notification devices and each person's switches.
type PushHandler struct{ svc *services.NotifyService }

func NewPushHandler(svc *services.NotifyService) *PushHandler { return &PushHandler{svc: svc} }

// Key handles GET /push/key: the VAPID public key the browser subscribes with.
func (h *PushHandler) Key(w http.ResponseWriter, _ *http.Request) {
	api.WriteJSON(w, http.StatusOK, map[string]string{"publicKey": h.svc.PublicKey()})
}

type pushSubReq struct {
	Endpoint string `json:"endpoint"`
	// ExpirationTime is part of PushSubscription.toJSON(); it is accepted and ignored.
	ExpirationTime *float64 `json:"expirationTime"`
	Keys           struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
	UserAgent string `json:"userAgent"`
}

// Subscribe handles PUT /push/subscriptions. It is an upsert by endpoint, so repeating it is safe.
func (h *PushHandler) Subscribe(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	var req pushSubReq
	if !decodeLimited(w, r, maxPushBody, &req) {
		return
	}
	if err := h.svc.Subscribe(r.Context(), u, services.SubscribeInput{
		Endpoint: req.Endpoint, P256dh: req.Keys.P256dh, Auth: req.Keys.Auth, UserAgent: req.UserAgent,
	}); err != nil {
		api.WriteJSON(w, statusFromErr(err), map[string]string{"error": "invalid subscription"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type pushUnsubReq struct {
	Endpoint string `json:"endpoint"`
}

// Unsubscribe handles DELETE /push/subscriptions {endpoint}. Only the caller's own device goes.
func (h *PushHandler) Unsubscribe(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	var req pushUnsubReq
	if !decodeLimited(w, r, maxPushBody, &req) {
		return
	}
	if err := h.svc.Unsubscribe(r.Context(), u, req.Endpoint); err != nil {
		api.WriteJSON(w, statusFromErr(err), map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Prefs handles GET /me/notifications.
func (h *PushHandler) Prefs(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	api.WriteJSON(w, http.StatusOK, h.svc.Prefs(u))
}

// SetPrefs handles PUT /me/notifications with any of {itemAdds, autopilot, tripReminders}.
func (h *PushHandler) SetPrefs(w http.ResponseWriter, r *http.Request) {
	u, ok := api.UserFrom(r.Context())
	if !ok {
		api.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	var req services.NotifyPrefsPatch
	if !decodeLimited(w, r, maxPushBody, &req) {
		return
	}
	out, err := h.svc.SetPrefs(r.Context(), u, req)
	if err != nil {
		api.WriteJSON(w, statusFromErr(err), map[string]string{"error": err.Error()})
		return
	}
	api.WriteJSON(w, http.StatusOK, out)
}
