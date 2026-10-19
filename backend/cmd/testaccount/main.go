// Command testaccount turns test mode on or off for an account.
//
// Usage: testaccount grant <username>
//
//	testaccount revoke <username>
//
// A test account sees the Test mode panel in Account settings and can run the actions in
// services.TestModeService (send itself a push, simulate adds, ...). This command is the only way
// to become one: no API route sets the flag, so nobody can promote themselves. It reads the same
// environment as the server (MONGODB_URI, MONGODB_DB). In the production image the entrypoint
// starts the server, so run it with an override:
//
//	docker run --entrypoint /usr/local/bin/testaccount <image> grant jan
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/config"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
	mongostore "github.com/janvillarosa/gracie-app/backend/internal/store/mongo"
)

func parseArgs(args []string) (grant bool, username string, err error) {
	if len(args) != 2 || (args[0] != "grant" && args[0] != "revoke") || args[1] == "" {
		return false, "", errors.New("usage: testaccount grant|revoke <username>")
	}
	return args[0] == "grant", args[1], nil
}

// run sets the flag and reports what it did.
func run(ctx context.Context, users store.UserRepository, out io.Writer, grant bool, username string) error {
	u, err := users.GetByUsername(ctx, username)
	if err != nil {
		return fmt.Errorf("find %q: %w", username, err)
	}
	if err := users.SetTestAccount(ctx, u.UserID, grant, time.Now().UTC()); err != nil {
		return err
	}
	state := "is now"
	if !grant {
		state = "is no longer"
	}
	_, _ = fmt.Fprintf(out, "%s (%s) %s a test account\n", u.Username, u.UserID, state)
	return nil
}

func main() {
	grant, username, err := parseArgs(os.Args[1:])
	if err != nil {
		log.Fatal(err)
	}
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	mcli, err := mongostore.New(ctx, cfg.MongoURI, cfg.MongoDB)
	if err != nil {
		log.Fatalf("mongo connect: %v", err)
	}
	if err := run(ctx, mongostore.NewUserRepo(mcli), os.Stdout, grant, username); err != nil {
		log.Fatal(err)
	}
}
