package main

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

func TestParseArgs(t *testing.T) {
	if g, u, err := parseArgs([]string{"grant", "jan"}); err != nil || !g || u != "jan" {
		t.Fatalf("grant: %v %v %v", g, u, err)
	}
	if g, _, err := parseArgs([]string{"revoke", "jan"}); err != nil || g {
		t.Fatalf("revoke: %v %v", g, err)
	}
	for _, bad := range [][]string{nil, {"grant"}, {"promote", "jan"}, {"grant", ""}, {"grant", "a", "b"}} {
		if _, _, err := parseArgs(bad); err == nil {
			t.Errorf("%v accepted", bad)
		}
	}
}

func TestRunGrantsAndRevokes(t *testing.T) {
	ctx := context.Background()
	m := memstore.Compose()
	_ = m.Users.Put(ctx, &models.User{UserID: "u1", Name: "Jan", Username: "jan", CreatedAt: time.Now(), UpdatedAt: time.Now()})
	var out bytes.Buffer
	if err := run(ctx, m.Users, &out, true, "jan"); err != nil {
		t.Fatal(err)
	}
	if u, _ := m.Users.GetByID(ctx, "u1"); !u.TestAccount || !strings.Contains(out.String(), "is now a test account") {
		t.Fatalf("grant: %+v %q", u, out.String())
	}
	out.Reset()
	if err := run(ctx, m.Users, &out, false, "jan"); err != nil {
		t.Fatal(err)
	}
	if u, _ := m.Users.GetByID(ctx, "u1"); u.TestAccount || !strings.Contains(out.String(), "no longer") {
		t.Fatalf("revoke: %+v %q", u, out.String())
	}
	if err := run(ctx, m.Users, &out, true, "nobody"); err == nil {
		t.Fatal("unknown username accepted")
	}
}
