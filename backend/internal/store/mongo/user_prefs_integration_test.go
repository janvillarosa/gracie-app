//go:build integration

package mongo

import (
	"context"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func TestMongoUserPreferencesNestedSetRoundTrip(t *testing.T) {
	c := connectOrSkip(t)
	ur := NewUserRepo(c)
	ctx := context.Background()
	now := time.Now().UTC()
	u := &models.User{UserID: "usr_" + randHex(4), Name: "A", CreatedAt: now, UpdatedAt: now}
	if err := ur.Put(ctx, u); err != nil {
		t.Fatal(err)
	}
	got, _ := ur.GetByID(ctx, u.UserID)
	if got.Preferences.TripsShowNextStop != nil || !got.TripsShowNextStop() {
		t.Fatalf("legacy user must default to true: %+v", got.Preferences)
	}

	f := false
	if err := ur.UpdatePreferences(ctx, u.UserID, models.UserPreferences{TripsShowNextStop: &f}, now); err != nil {
		t.Fatal(err)
	}
	got, _ = ur.GetByID(ctx, u.UserID)
	if got.Preferences.TripsShowNextStop == nil || *got.Preferences.TripsShowNextStop || got.TripsShowNextStop() {
		t.Fatalf("not persisted: %+v", got.Preferences)
	}

	// an empty patch must not clobber the stored value, and a name update must not either
	if err := ur.UpdatePreferences(ctx, u.UserID, models.UserPreferences{}, now); err != nil {
		t.Fatal(err)
	}
	if err := ur.UpdateName(ctx, u.UserID, "B", now); err != nil {
		t.Fatal(err)
	}
	got, _ = ur.GetByID(ctx, u.UserID)
	if got.Name != "B" || got.Preferences.TripsShowNextStop == nil || *got.Preferences.TripsShowNextStop {
		t.Fatalf("clobbered: %+v", got)
	}

	if err := ur.UpdatePreferences(ctx, "usr_missing", models.UserPreferences{TripsShowNextStop: &f}, now); err == nil {
		t.Fatalf("unknown user should be not found")
	}
}
