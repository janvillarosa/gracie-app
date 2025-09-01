package main

import (
    "context"
    "log"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"

    "github.com/janvillarosa/gracie-app/backend/internal/config"
    "github.com/janvillarosa/gracie-app/backend/internal/http/handlers"
    "github.com/janvillarosa/gracie-app/backend/internal/http/router"
    "github.com/janvillarosa/gracie-app/backend/internal/services"
    "github.com/janvillarosa/gracie-app/backend/internal/store/dynamo"
)

func main() {
    cfg, err := config.Load()
    if err != nil {
        log.Fatalf("config: %v", err)
    }

    ctx := context.Background()
    ddb, err := dynamo.New(ctx, cfg.AWSRegion, cfg.DDBEndpoint, dynamo.Tables{Users: cfg.UsersTable, Rooms: cfg.RoomsTable, Lists: cfg.ListsTable, ListItems: cfg.ListItemsTable})
    if err != nil {
        log.Fatalf("dynamo client: %v", err)
    }

    usersRepo := dynamo.NewUserRepo(ddb)
    roomsRepo := dynamo.NewRoomRepo(ddb)
    listsRepo := dynamo.NewListRepo(ddb)
    itemsRepo := dynamo.NewListItemRepo(ddb)

    userSvc := services.NewUserService(ddb, usersRepo)
    roomSvc := services.NewRoomService(ddb, usersRepo, roomsRepo)
    roomSvc.UseListRepos(listsRepo, itemsRepo)
    listSvc := services.NewListService(ddb, usersRepo, roomsRepo, listsRepo, itemsRepo)
    authSvc, err := services.NewAuthService(ddb, usersRepo, cfg.EncKeyFile, cfg.APIKeyTTLHours)
    if err != nil { log.Fatalf("auth service: %v", err) }

    userHandler := handlers.NewUserHandler(userSvc)
    authHandler := handlers.NewAuthHandler(authSvc)
    roomHandler := handlers.NewRoomHandler(roomSvc, usersRepo)
    listHandler := handlers.NewListHandler(listSvc)

    r := router.NewRouter(usersRepo, authHandler, userHandler, roomHandler, listHandler)

    srv := &http.Server{
        Addr:         ":" + cfg.Port,
        Handler:      r,
        ReadTimeout:  10 * time.Second,
        WriteTimeout: 10 * time.Second,
        IdleTimeout:  60 * time.Second,
    }

    // Graceful shutdown
    go func() {
        log.Printf("listening on :%s", cfg.Port)
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            log.Fatalf("server: %v", err)
        }
    }()

    stop := make(chan os.Signal, 1)
    signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
    <-stop
    log.Println("shutting down...")
    ctxTimeout, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    _ = srv.Shutdown(ctxTimeout)
}
