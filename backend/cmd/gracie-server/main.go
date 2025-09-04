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
    mongostore "github.com/janvillarosa/gracie-app/backend/internal/store/mongo"
)

func main() {
    cfg, err := config.Load()
    if err != nil {
        log.Fatalf("config: %v", err)
    }

    ctx := context.Background()
    mcli, err := mongostore.New(ctx, cfg.MongoURI, cfg.MongoDB)
    if err != nil { log.Fatalf("mongo connect: %v", err) }
    usersRepo := mongostore.NewUserRepo(mcli)
    roomsRepo := mongostore.NewRoomRepo(mcli)
    listsRepo := mongostore.NewListRepo(mcli)
    itemsRepo := mongostore.NewListItemRepo(mcli)
    _ = usersRepo.EnsureIndexes(ctx)
    _ = roomsRepo.EnsureIndexes(ctx)
    _ = listsRepo.EnsureIndexes(ctx)
    _ = itemsRepo.EnsureIndexes(ctx)
    tx := mongostore.NewTx(mcli)

    userSvc := services.NewUserService(usersRepo, roomsRepo, tx)
    roomSvc := services.NewRoomService(usersRepo, roomsRepo, tx)
    roomSvc.UseListRepos(listsRepo, itemsRepo)
    userSvc.UseListRepos(listsRepo, itemsRepo)
    listSvc := services.NewListService(usersRepo, roomsRepo, listsRepo, itemsRepo)
    authSvc, err := services.NewAuthService(usersRepo, cfg.EncKeyFile, cfg.APIKeyTTLHours)
    if err != nil { log.Fatalf("auth service: %v", err) }

    userHandler := handlers.NewUserHandler(userSvc, []byte(cfg.AvatarSalt))
    authHandler := handlers.NewAuthHandler(authSvc)
    roomHandler := handlers.NewRoomHandler(roomSvc, usersRepo, []byte(cfg.AvatarSalt))
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
