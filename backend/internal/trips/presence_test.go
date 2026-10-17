package trips

import (
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func sp(s string) *string { return &s }

func datedTrip(start, end, tz string, travellers ...string) models.Trip {
	t := models.Trip{TripID: "trip_x", RoomID: "room_1"}
	t.StartDate, t.EndDate, t.TZ = sp(start), sp(end), tz
	t.Travellers = travellers
	return t
}

func utc(s string) time.Time {
	v, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return v.UTC()
}

func TestWholeHouseTripIsHouseAway(t *testing.T) {
	trips := []models.Trip{datedTrip("2026-07-01", "2026-07-14", "Europe/Lisbon")}
	got := HouseAway(trips, []string{"a", "b"}, "Europe/London")
	if len(got) != 1 {
		t.Fatalf("want one span, got %v", got)
	}
	// Lisbon is UTC+1 in July: local midnights are 23:00 UTC the day before
	if !got[0].Opens.Equal(utc("2026-06-30T23:00:00Z")) || !got[0].Closes.Equal(utc("2026-07-14T23:00:00Z")) {
		t.Fatalf("span = %v .. %v", got[0].Opens, got[0].Closes)
	}
}

func TestSoloTripIsNotHouseAway(t *testing.T) {
	trips := []models.Trip{datedTrip("2026-07-01", "2026-07-03", "", "a")}
	if got := HouseAway(trips, []string{"a", "b"}, "UTC"); len(got) != 0 {
		t.Fatalf("one of two away is not the house away: %v", got)
	}
	if got := MemberAway(trips, "a", "UTC"); len(got) != 1 || !got[0].Opens.Equal(utc("2026-07-01T00:00:00Z")) || !got[0].Closes.Equal(utc("2026-07-04T00:00:00Z")) {
		t.Fatalf("member a is away: %v", got)
	}
	if got := MemberAway(trips, "b", "UTC"); len(got) != 0 {
		t.Fatalf("member b is home: %v", got)
	}
}

func TestHouseAwayIsWhenEveryMemberIsAway(t *testing.T) {
	trips := []models.Trip{
		datedTrip("2026-07-01", "2026-07-10", "", "a"),
		datedTrip("2026-07-05", "2026-07-20", "", "b"),
	}
	got := HouseAway(trips, []string{"a", "b"}, "UTC")
	if len(got) != 1 || !got[0].Opens.Equal(utc("2026-07-05T00:00:00Z")) || !got[0].Closes.Equal(utc("2026-07-11T00:00:00Z")) {
		t.Fatalf("overlap only: %v", got)
	}
}

func TestHouseTZWhenTripHasNone(t *testing.T) {
	trips := []models.Trip{datedTrip("2026-01-10", "2026-01-10", "")}
	got := HouseAway(trips, []string{"a"}, "America/New_York")
	if len(got) != 1 || !got[0].Opens.Equal(utc("2026-01-10T05:00:00Z")) || !got[0].Closes.Equal(utc("2026-01-11T05:00:00Z")) {
		t.Fatalf("house zone: %v", got)
	}
	// an unknown zone falls back to UTC rather than dropping the trip
	if got := HouseAway(trips, []string{"a"}, "Not/AZone"); len(got) != 1 || !got[0].Opens.Equal(utc("2026-01-10T00:00:00Z")) {
		t.Fatalf("fallback: %v", got)
	}
}

func TestDeletedAndDatelessTripsAreIgnored(t *testing.T) {
	deleted := datedTrip("2026-07-01", "2026-07-03", "")
	now := time.Now()
	deleted.DeletedAt = &now
	noEnd := datedTrip("2026-07-01", "2026-07-03", "")
	noEnd.EndDate = nil
	noStart := datedTrip("2026-07-01", "2026-07-03", "")
	noStart.StartDate = nil
	bad := datedTrip("2026-07-05", "2026-07-03", "")
	if got := HouseAway([]models.Trip{deleted, noEnd, noStart, bad}, []string{"a"}, "UTC"); len(got) != 0 {
		t.Fatalf("got %v", got)
	}
}

func TestMembersWhoLeftAreIgnored(t *testing.T) {
	// "gone" left the house: a trip only they went on is nobody's, and does not stop the
	// whole house from being away when everyone current goes.
	trips := []models.Trip{
		datedTrip("2026-07-01", "2026-07-03", "", "gone"),
		datedTrip("2026-08-01", "2026-08-03", "", "a", "gone"),
	}
	if got := HouseAway(trips, []string{"a"}, "UTC"); len(got) != 1 || !got[0].Opens.Equal(utc("2026-08-01T00:00:00Z")) {
		t.Fatalf("got %v", got)
	}
	if got := HouseAway(trips, nil, "UTC"); len(got) != 0 {
		t.Fatalf("a house with no members is never away: %v", got)
	}
}
