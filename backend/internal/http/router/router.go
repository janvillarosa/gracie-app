package router

import (
    "net/http"

    "github.com/go-chi/chi/v5"
    "github.com/go-chi/chi/v5/middleware"
    "github.com/janvillarosa/gracie-app/backend/internal/http/handlers"
    authmw "github.com/janvillarosa/gracie-app/backend/internal/http/middleware"
    "github.com/janvillarosa/gracie-app/backend/internal/store/dynamo"
)

func NewRouter(usersRepo *dynamo.UserRepo, authHandler *handlers.AuthHandler, userHandler *handlers.UserHandler, roomHandler *handlers.RoomHandler) http.Handler {
    r := chi.NewRouter()
    r.Use(middleware.RequestID)
    r.Use(middleware.Logger)
    r.Use(middleware.Recoverer)

    // Public endpoints
    r.Post("/auth/register", authHandler.Register)
    r.Post("/auth/login", authHandler.Login)
    r.Post("/users", userHandler.CreateUser)

    // Authenticated endpoints
    r.Group(func(ar chi.Router) {
        ar.Use(authmw.AuthMiddleware(usersRepo))

        ar.Get("/me", userHandler.GetMe)
        ar.Put("/me", userHandler.UpdateMe)

        ar.Get("/rooms/me", roomHandler.GetMyRoom)
        ar.Post("/rooms", roomHandler.CreateSoloRoom)
        ar.Post("/rooms/share", roomHandler.ShareRoom)
        ar.Post("/rooms/join", roomHandler.JoinByToken)
        ar.Post("/rooms/{room_id}/join", roomHandler.JoinRoom)
        ar.Post("/rooms/deletion/vote", roomHandler.VoteDeletion)
        ar.Post("/rooms/deletion/cancel", roomHandler.CancelDeletion)
    })

    return r
}
