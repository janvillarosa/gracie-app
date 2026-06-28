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
    "github.com/janvillarosa/gracie-app/backend/internal/services/categorization"
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
    categorizers := buildCategorizers(ctx, cfg)
    listSvc := services.NewListService(usersRepo, roomsRepo, listsRepo, itemsRepo, categorizers["grocery"])
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

// buildEmbedder loads the shared embedding model once, or returns nil when
// embeddings are disabled or the model fails to load (callers then degrade to
// keyword-only). One embedder instance is reused across all domains.
func buildEmbedder(ctx context.Context, cfg *config.Config) categorization.Embedder {
	if !cfg.EmbeddingEnabled {
		log.Printf("categorization: embedding disabled (keyword mode)")
		return nil
	}
	emb, err := categorization.NewHugotEmbedder(ctx, cfg.EmbeddingModelPath)
	if err != nil {
		log.Printf("categorization: embedding init failed (%v); keyword fallback for all domains", err)
		return nil
	}
	log.Printf("categorization: embedding model loaded (model=%s, threshold=%.2f, topK=%d)", cfg.EmbeddingModelPath, cfg.EmbedThreshold, cfg.EmbedTopK)
	return emb
}

// domainCategorizer builds one domain's Chain: embedding (when the shared
// embedder is available) backed by keyword matching over the same anchor set,
// with a per-domain fallback label. Anchor embedding failure degrades to
// keyword-only for that domain.
func domainCategorizer(ctx context.Context, emb categorization.Embedder, anchors []categorization.Anchor, fallback string, cfg *config.Config) categorization.Categorizer {
	keyword := categorization.NewKeywordCategorizer(anchors)
	if emb == nil {
		return categorization.NewChain(fallback, keyword)
	}
	ec, err := categorization.NewEmbeddingCategorizerWithEmbedder(ctx, emb, anchors, cfg.EmbedThreshold, cfg.EmbedTopK)
	if err != nil {
		log.Printf("categorization: anchor embedding failed (%v); keyword-only for this domain", err)
		return categorization.NewChain(fallback, keyword)
	}
	return categorization.NewChain(fallback, ec, keyword)
}

// buildCategorizers returns the per-domain registry. Add a new domain (e.g.
// list-type suggestion) by adding one line with its anchor set + fallback;
// the embedding model is shared, not reloaded.
func buildCategorizers(ctx context.Context, cfg *config.Config) map[string]categorization.Categorizer {
	emb := buildEmbedder(ctx, cfg)
	return map[string]categorization.Categorizer{
		"grocery": domainCategorizer(ctx, emb, categorization.GroceryAnchors, categorization.General, cfg),
		// Future: "list_type": domainCategorizer(ctx, emb, categorization.ListTypeAnchors, "", cfg),
	}
}
