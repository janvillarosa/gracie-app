package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/config"
	"github.com/janvillarosa/gracie-app/backend/internal/http/handlers"
	"github.com/janvillarosa/gracie-app/backend/internal/http/router"
	"github.com/janvillarosa/gracie-app/backend/internal/parse"
	"github.com/janvillarosa/gracie-app/backend/internal/ratelimit"
	"github.com/janvillarosa/gracie-app/backend/internal/services"
	"github.com/janvillarosa/gracie-app/backend/internal/services/categorization"
	mongostore "github.com/janvillarosa/gracie-app/backend/internal/store/mongo"
	"github.com/janvillarosa/gracie-app/backend/internal/trips"
	"github.com/janvillarosa/gracie-app/backend/internal/tzlookup"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	ctx := context.Background()
	mcli, err := mongostore.New(ctx, cfg.MongoURI, cfg.MongoDB)
	if err != nil {
		log.Fatalf("mongo connect: %v", err)
	}
	usersRepo := mongostore.NewUserRepo(mcli)
	roomsRepo := mongostore.NewRoomRepo(mcli)
	listsRepo := mongostore.NewListRepo(mcli)
	itemsRepo := mongostore.NewListItemRepo(mcli)
	_ = usersRepo.EnsureIndexes(ctx)
	_ = roomsRepo.EnsureIndexes(ctx)
	_ = listsRepo.EnsureIndexes(ctx)
	_ = itemsRepo.EnsureIndexes(ctx)
	tripsRepo := mongostore.NewTripRepo(mcli)
	if err := tripsRepo.EnsureIndexes(ctx); err != nil {
		log.Fatalf("trips: ensure indexes: %v", err)
	}
	tx := mongostore.NewTx(mcli)

	// Behavior analytics: buffered, non-blocking event capture. Disabled -> NopRecorder.
	analyticsReg := analytics.NewRegistry()
	var recorder analytics.Recorder = analytics.NopRecorder{}
	var bufRecorder *analytics.BufferedRecorder
	var rollup *analytics.Worker
	var purger *analytics.Purger
	var insights *handlers.InsightsHandler
	var analyticsReader *analytics.Reader
	var analyticsEvents analytics.EventRepository
	if cfg.AnalyticsEnabled {
		eventsRepo := mongostore.NewEventRepo(mcli)
		if err := eventsRepo.EnsureIndexes(ctx); err != nil {
			log.Printf("analytics: ensure indexes failed: %v (analytics disabled)", err)
		} else {
			bufRecorder = analytics.NewBufferedRecorder(eventsRepo, analyticsReg, cfg.AnalyticsBuffer, time.Duration(cfg.AnalyticsRetentionDays)*24*time.Hour)
			recorder = bufRecorder
			aggRepo := mongostore.NewAggRepo(mcli, tx)
			if err := aggRepo.EnsureIndexes(ctx); err != nil {
				log.Printf("analytics: aggregate indexes failed: %v (rollups disabled)", err)
			} else {
				// Trips reach analytics only through this port: away time is not time for a rhythm.
				awayCal := services.NewAwayCalendar(roomsRepo, usersRepo, tripsRepo)
				rollup = analytics.NewWorker(eventsRepo, aggRepo, analyticsReg).WithAway(awayCal)
				purger = analytics.NewPurger(eventsRepo, aggRepo)
				reader := analytics.NewReader(aggRepo).WithAway(awayCal)
				insights = handlers.NewInsightsHandler(services.NewInsightsService(roomsRepo, reader))
				analyticsReader, analyticsEvents = reader, eventsRepo
			}
		}
	}
	services.RegisterAnalyticsEvents(analyticsReg)
	trips.RegisterAnalyticsEvents(analyticsReg)

	var categoryIndex *mongostore.CategoryIndexRepo
	if cfg.CategoryIndexEnabled {
		categoryIndex = mongostore.NewCategoryIndexRepo(mcli)
		if err := categoryIndex.EnsureIndexes(ctx); err != nil {
			log.Printf("category_index: ensure indexes failed: %v (continuing without cache)", err)
			categoryIndex = nil
		} else {
			seed := make([]mongostore.CategoryIndexEntry, 0, len(categorization.GroceryAnchors))
			for _, a := range categorization.GroceryAnchors {
				seed = append(seed, mongostore.CategoryIndexEntry{
					Key:      parse.NormalizeKey(a.Term),
					Category: a.Category,
				})
			}
			if err := categoryIndex.Seed(ctx, seed); err != nil {
				log.Printf("category_index: anchor seed failed: %v (continuing)", err)
			} else {
				log.Printf("category_index: seeded %d anchors", len(seed))
			}
		}
	}

	userSvc := services.NewUserService(usersRepo, roomsRepo, tx)
	roomSvc := services.NewRoomService(usersRepo, roomsRepo, tx)
	roomSvc.UseListRepos(listsRepo, itemsRepo)
	userSvc.UseListRepos(listsRepo, itemsRepo)
	roomSvc.UseTripRepo(tripsRepo)
	userSvc.UseTripRepo(tripsRepo)
	categorizers := buildCategorizers(ctx, cfg, indexArg(categoryIndex))
	listSvc := services.NewListService(usersRepo, roomsRepo, listsRepo, itemsRepo, categorizers["grocery"])
	tripSvc := services.NewTripService(roomsRepo, tripsRepo, listSvc, listsRepo)
	// Smart suggestions answer with nothing while analytics is off (nil reader).
	suggestMode, legacyMode := services.ParseSuggestionMode(cfg.SuggestionsMode)
	if legacyMode {
		log.Printf("suggestions: SUGGESTIONS_MODE=%s is retired, running as on", cfg.SuggestionsMode)
	}
	autopilotSvc := services.NewAutopilotService(roomsRepo, listsRepo, itemsRepo, analyticsReader, analyticsEvents, suggestMode)
	log.Printf("suggestions: mode %s", suggestMode)

	// Coordinates -> time zone for Google places sent without one. The tzf dataset
	// (~34 MB heap, ~150 ms) loads lazily on the first such place, never at startup.
	tripSvc.UseTZ(tzlookup.NewLazy())

	authSvc, err := services.NewAuthService(usersRepo, cfg.EncKeyFile, cfg.APIKeyTTLHours)
	if err != nil {
		log.Fatalf("auth service: %v", err)
	}

	for _, svc := range []interface{ UseRecorder(analytics.Recorder) }{userSvc, roomSvc, listSvc, tripSvc, authSvc, autopilotSvc} {
		svc.UseRecorder(recorder)
	}
	if purger != nil {
		userSvc.UsePurger(purger)
		roomSvc.UsePurger(purger)
	}

	userHandler := handlers.NewUserHandler(userSvc, []byte(cfg.AvatarSalt))
	authHandler := handlers.NewAuthHandler(authSvc)
	roomHandler := handlers.NewRoomHandler(roomSvc, usersRepo, []byte(cfg.AvatarSalt))
	listHandler := handlers.NewListHandler(listSvc)

	tripHandler := handlers.NewTripHandler(tripSvc, ratelimit.New(cfg.TripsUserRPS, ratelimit.Burst(cfg.TripsUserRPS)))

	eventsHandler := handlers.NewEventsHandler(recorder, analyticsReg, ratelimit.New(cfg.AnalyticsEventsRPS, ratelimit.Burst(cfg.AnalyticsEventsRPS)))

	r := router.NewRouter(usersRepo, router.Handlers{Auth: authHandler, User: userHandler, Room: roomHandler, List: listHandler, Trip: tripHandler, Events: eventsHandler, Insights: insights, Autopilot: handlers.NewAutopilotHandler(autopilotSvc)})

	// Google Maps Platform allows storing coordinates for 30 days: purge stale ones at startup
	// and daily (plus up to an hour of jitter so instances do not fire together).
	purgeCtx, stopPurge := context.WithCancel(context.Background())
	defer stopPurge()
	go tripSvc.RunCoordsPurge(purgeCtx, 24*time.Hour, time.Hour)
	if rollup != nil {
		// Fold raw events into aggregates; the lease makes it safe on any number of instances.
		go rollup.RunFold(purgeCtx, cfg.AnalyticsFoldEvery, cfg.AnalyticsFoldEvery/10)
		go rollup.RunProfiles(purgeCtx, cfg.AnalyticsProfileEvery, cfg.AnalyticsProfileEvery/10)
	}

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
	// Drain analytics after the server stops accepting writes, so buffered events are not lost.
	if bufRecorder != nil {
		if err := bufRecorder.Close(ctxTimeout); err != nil {
			log.Printf("analytics: drain on shutdown: %v", err)
		}
	}
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
// keyword-only for that domain. When an index is provided the embedding
// categorizer is wrapped in a CachingCategorizer.
func domainCategorizer(ctx context.Context, emb categorization.Embedder, anchors []categorization.Anchor, fallback string, cfg *config.Config, index categorization.CategoryIndex) categorization.Categorizer {
	keyword := categorization.NewKeywordCategorizer(anchors)
	if emb == nil {
		return categorization.NewChain(fallback, keyword)
	}
	ec, err := categorization.NewEmbeddingCategorizerWithEmbedder(ctx, emb, anchors, cfg.EmbedThreshold, cfg.EmbedTopK)
	if err != nil {
		log.Printf("categorization: anchor embedding failed (%v); keyword-only for this domain", err)
		return categorization.NewChain(fallback, keyword)
	}
	var embMember categorization.Categorizer = ec
	if index != nil {
		embMember = categorization.NewCachingCategorizer(ec, index)
	}
	return categorization.NewChain(fallback, embMember, keyword)
}

// indexArg converts a possibly-nil concrete repo pointer into a clean typed nil
// interface, so domainCategorizer's `index != nil` check works correctly.
// A non-nil interface wrapping a nil pointer would always pass the != nil check.
func indexArg(r *mongostore.CategoryIndexRepo) categorization.CategoryIndex {
	if r == nil {
		return nil
	}
	return r
}

// buildCategorizers returns the per-domain registry. Add a new domain (e.g.
// list-type suggestion) by adding one entry with its anchor set + fallback;
// the embedding model is shared, not reloaded.
//
// Each domain starts keyword-only so the server can listen at once (a volume-backed
// Railway service cannot overlap deploys, so every startup second is downtime).
// The model load and anchor embedding run in the background and swap in when ready.
func buildCategorizers(ctx context.Context, cfg *config.Config, index categorization.CategoryIndex) map[string]categorization.Categorizer {
	type domain struct {
		anchors  []categorization.Anchor
		fallback string
	}
	domains := map[string]domain{
		"grocery": {categorization.GroceryAnchors, categorization.General},
		// Future: "list_type": {categorization.ListTypeAnchors, ""},
	}
	swaps := make(map[string]*categorization.Swappable, len(domains))
	out := make(map[string]categorization.Categorizer, len(domains))
	for name, d := range domains {
		swaps[name] = categorization.NewSwappable(categorization.NewChain(d.fallback, categorization.NewKeywordCategorizer(d.anchors)))
		out[name] = swaps[name]
	}
	if !cfg.EmbeddingEnabled {
		log.Printf("categorization: embedding disabled (keyword mode)")
		return out
	}
	go func() {
		start := time.Now()
		emb := buildEmbedder(ctx, cfg)
		if emb == nil {
			return
		}
		for name, d := range domains {
			swaps[name].Swap(domainCategorizer(ctx, emb, d.anchors, d.fallback, cfg, index))
		}
		log.Printf("categorization: embedding ready in %s", time.Since(start).Round(time.Millisecond))
	}()
	return out
}
