package router

import (
    "net/http"
    "os"

    "github.com/go-chi/chi/v5"
    "github.com/go-chi/chi/v5/middleware"
    "github.com/go-chi/cors"
    "github.com/janvillarosa/gracie-app/backend/internal/http/handlers"
    authmw "github.com/janvillarosa/gracie-app/backend/internal/http/middleware"
)

func NewRouter(userFinder authmw.UserFinder, authHandler *handlers.AuthHandler, userHandler *handlers.UserHandler, roomHandler *handlers.RoomHandler, listHandler *handlers.ListHandler) http.Handler {
    r := chi.NewRouter()
    r.Use(middleware.RequestID)
    r.Use(middleware.Logger)
    r.Use(middleware.Recoverer)

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
        AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Requested-With"},
        ExposedHeaders:   []string{"Link"},
        AllowCredentials: allowCreds,
        MaxAge:           300,
    }))

    // Public endpoints
    r.Post("/auth/register", authHandler.Register)
    r.Post("/auth/login", authHandler.Login)
    r.Post("/users", userHandler.CreateUser)

    // Authenticated endpoints
    r.Group(func(ar chi.Router) {
        ar.Use(authmw.AuthMiddleware(userFinder))

        ar.Get("/me", userHandler.GetMe)
        ar.Put("/me", userHandler.UpdateMe)

        ar.Get("/rooms/me", roomHandler.GetMyRoom)
        ar.Post("/rooms", roomHandler.CreateSoloRoom)
        ar.Post("/rooms/share", roomHandler.ShareRoom)
        ar.Post("/rooms/join", roomHandler.JoinByToken)
        ar.Post("/rooms/{room_id}/join", roomHandler.JoinRoom)
        ar.Put("/rooms/settings", roomHandler.UpdateSettings)
        ar.Post("/rooms/deletion/vote", roomHandler.VoteDeletion)
        ar.Post("/rooms/deletion/cancel", roomHandler.CancelDeletion)

        // Lists
        ar.Post("/rooms/{room_id}/lists", listHandler.CreateList)
        ar.Get("/rooms/{room_id}/lists", listHandler.ListLists)
        ar.Patch("/rooms/{room_id}/lists/{list_id}", listHandler.UpdateList)
        ar.Post("/rooms/{room_id}/lists/{list_id}/deletion/vote", listHandler.VoteListDeletion)
        ar.Post("/rooms/{room_id}/lists/{list_id}/deletion/cancel", listHandler.CancelListDeletionVote)
        ar.Post("/rooms/{room_id}/lists/{list_id}/items", listHandler.CreateItem)
        ar.Get("/rooms/{room_id}/lists/{list_id}/items", listHandler.ListItems)
        ar.Patch("/rooms/{room_id}/lists/{list_id}/items/{item_id}", listHandler.UpdateItem)
        ar.Delete("/rooms/{room_id}/lists/{list_id}/items/{item_id}", listHandler.DeleteItem)
    })

    return r
}
