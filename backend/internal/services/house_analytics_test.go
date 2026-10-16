package services

import (
	"context"
	"reflect"
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

func TestHouseAndAccountEventsEmitted(t *testing.T) {
	m := memstore.Compose()
	reg := analytics.NewRegistry()
	RegisterAnalyticsEvents(reg)
	rec := analytics.NewMemRecorder(reg)
	us := NewUserService(m.Users, m.Rooms, m.Tx)
	rs := NewRoomService(m.Users, m.Rooms, m.Tx)
	us.UseRecorder(rec)
	rs.UseRecorder(rec)
	ctx := context.Background()

	a, _ := us.CreateUserWithSoloRoom(ctx, "A")
	b, _ := us.CreateUserWithSoloRoom(ctx, "B")
	roomA := *a.User.RoomID

	token, err := rs.RotateShareToken(ctx, a.User)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := rs.JoinRoomByToken(ctx, b.User, token); err != nil {
		t.Fatal(err)
	}
	newName := "Home"
	if err := rs.UpdateRoomSettings(ctx, a.User, &newName, nil); err != nil {
		t.Fatal(err)
	}
	if err := us.UpdateProfile(ctx, a.User.UserID, &newName, nil); err != nil {
		t.Fatal(err)
	}

	want := []string{
		"user.signed_up", "house.created", "user.signed_up", "house.created",
		"house.invite_rotated", "house.joined", "house.settings_updated", "user.profile_updated",
	}
	if got := rec.Names(); !reflect.DeepEqual(got, want) {
		t.Fatalf("events\n got %v\nwant %v", got, want)
	}
	evs := rec.Events()
	if joined := evs[5]; joined.ActorID != b.User.UserID || joined.RoomID != roomA || joined.Subject.Type != "house" {
		t.Fatalf("joined: %+v", joined)
	}
	if settings := evs[6]; settings.Props["fields"] != "display_name" {
		t.Fatalf("settings: %+v", settings)
	}
}
