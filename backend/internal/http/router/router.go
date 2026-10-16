package router

import (
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/janvillarosa/gracie-app/backend/internal/http/handlers"
	authmw "github.com/janvillarosa/gracie-app/backend/internal/http/middleware"
)

// Handlers groups the HTTP handlers the router wires up.
type Handlers struct {
	Auth *handlers.AuthHandler
	User *handlers.UserHandler
	Room *handlers.RoomHandler
	List *handlers.ListHandler
	Trip *handlers.TripHandler
	// Events is optional: when nil, POST /events is not mounted.
	Events *handlers.EventsHandler
	// Insights is optional: when nil, the insights routes are not mounted.
	Insights *handlers.InsightsHandler
}

// redactPlacesQuery keeps /places/* query strings (search text, exact coordinates) out of
// the access log. Logger reads RequestURI; handlers read URL.RawQuery, which is untouched.
func redactPlacesQuery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/places/") {
			r.RequestURI = r.URL.Path
		}
		next.ServeHTTP(w, r)
	})
}

func NewRouter(userFinder authmw.UserFinder, h Handlers) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(redactPlacesQuery)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Compress(5, "application/json"))
	r.Use(authmw.Timezone)

	// CORS for production (Vercel frontend → Railway API). Control via CORS_ORIGIN env.
	// If CORS_ORIGIN is set, allow only that origin and credentials; otherwise allow all without credentials.
	origin := os.Getenv("CORS_ORIGIN")
	allowedOrigins := []string{"*"}
	allowCreds := false
	if origin != "" {
		allowedOrigins = []string{origin}
		allowCreds = true
	}
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   allowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Requested-With", "X-Timezone"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: allowCreds,
		MaxAge:           300,
	}))

	// Public endpoints
	r.Post("/auth/register", h.Auth.Register)
	r.Post("/auth/login", h.Auth.Login)
	r.Post("/users", h.User.CreateUser)

	// Authenticated endpoints
	r.Group(func(ar chi.Router) {
		ar.Use(authmw.AuthMiddleware(userFinder))
		if tzStore, ok := userFinder.(authmw.TZStore); ok {
			ar.Use(authmw.SyncTimezone(tzStore))
		}

		ar.Get("/me", h.User.GetMe)
		ar.Put("/me", h.User.UpdateMe)
		ar.Patch("/me", h.User.UpdateMePartial)
		ar.Post("/me/password", h.Auth.ChangePassword)
		ar.Delete("/me", h.User.DeleteMe)

		ar.Get("/rooms/me", h.Room.GetMyRoom)
		ar.Get("/rooms/{room_id}/pantry", h.List.GetPantry)
		ar.Post("/rooms", h.Room.CreateSoloRoom)
		ar.Get("/rooms/share", h.Room.GetShareToken)
		ar.Post("/rooms/share", h.Room.ShareRoom)
		ar.Post("/rooms/join", h.Room.JoinByToken)
		ar.Post("/rooms/{room_id}/join", h.Room.JoinRoom)
		ar.Put("/rooms/settings", h.Room.UpdateSettings)
		ar.Post("/rooms/deletion/vote", h.Room.VoteDeletion)
		ar.Post("/rooms/deletion/cancel", h.Room.CancelDeletion)

		// Lists
		ar.Post("/rooms/{room_id}/lists", h.List.CreateList)
		ar.Get("/rooms/{room_id}/lists", h.List.ListLists)
		ar.Patch("/rooms/{room_id}/lists/{list_id}", h.List.UpdateList)
		ar.Post("/rooms/{room_id}/lists/{list_id}/deletion/vote", h.List.VoteListDeletion)
		ar.Post("/rooms/{room_id}/lists/{list_id}/deletion/cancel", h.List.CancelListDeletionVote)
		ar.Post("/rooms/{room_id}/lists/{list_id}/clear", h.List.ArchiveCompleted)
		ar.Post("/rooms/{room_id}/lists/{list_id}/items", h.List.CreateItem)
		ar.Get("/rooms/{room_id}/lists/{list_id}/items", h.List.ListItems)
		ar.Patch("/rooms/{room_id}/lists/{list_id}/items/{item_id}", h.List.UpdateItem)
		ar.Patch("/rooms/{room_id}/lists/{list_id}/items/{item_id}/position", h.List.UpdateItemPosition)
		ar.Delete("/rooms/{room_id}/lists/{list_id}/items/{item_id}", h.List.DeleteItem)
		if h.Insights != nil {
			ar.Get("/me/insights", h.Insights.Mine)
			ar.Get("/rooms/{room_id}/insights", h.Insights.House)
			ar.Get("/rooms/{room_id}/insights/periods/{period}", h.Insights.HousePeriod)
		}
		if h.Events != nil {
			ar.Post("/events", h.Events.Ingest)
		}
		if h.Trip != nil {
			ar.Post("/rooms/{room_id}/trips/sync", h.Trip.Sync)
			ar.Post("/rooms/{room_id}/trips/ops", h.Trip.Ops)
			ar.Post("/rooms/{room_id}/trips/{trip_id}/packing-list", h.Trip.PackingList)
		}
	})

	return r
}
