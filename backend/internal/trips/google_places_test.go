package trips

import (
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func fp(v float64) *float64 { return &v }
func tp(v time.Time) *time.Time {
	return &v
}

func TestValidPlaceTable(t *testing.T) {
	now := now0
	fresh := tp(now.Add(-24 * time.Hour))
	edge := tp(now.Add(-models.CoordsMaxAge))
	stale := tp(now.Add(-models.CoordsMaxAge - time.Minute))
	future := tp(now.Add(time.Hour))
	long := make([]byte, 257)
	for i := range long {
		long[i] = 'x'
	}
	cases := []struct {
		name string
		p    models.Place
		ok   bool
	}{
		{"google ok", models.Place{PlaceID: "ChIJ1", Lat: fp(1), Lng: fp(2), TZ: "Asia/Tokyo", CoordsFetchedAt: fresh, Source: "google"}, true},
		{"google exactly 30 days", models.Place{PlaceID: "ChIJ1", Lat: fp(1), Lng: fp(2), CoordsFetchedAt: edge, Source: "google"}, true},
		{"google id only", models.Place{PlaceID: "ChIJ1", Source: "google"}, true},
		{"google id and tz only (purged)", models.Place{PlaceID: "ChIJ1", TZ: "Asia/Tokyo", Source: "google"}, true},
		{"google user-typed locality", models.Place{PlaceID: "ChIJ1", Locality: "Kyoto", Source: "google"}, true},
		{"google without place_id", models.Place{Lat: fp(1), Lng: fp(2), CoordsFetchedAt: fresh, Source: "google"}, false},
		{"google with name", models.Place{PlaceID: "ChIJ1", Name: "Kyoto Station", Source: "google"}, false},
		{"google with address", models.Place{PlaceID: "ChIJ1", Address: "1 Karasuma", Source: "google"}, false},
		{"google stale coords", models.Place{PlaceID: "ChIJ1", Lat: fp(1), Lng: fp(2), CoordsFetchedAt: stale, Source: "google"}, false},
		{"google coords without fetched_at", models.Place{PlaceID: "ChIJ1", Lat: fp(1), Lng: fp(2), Source: "google"}, false},
		{"google future fetched_at", models.Place{PlaceID: "ChIJ1", Lat: fp(1), Lng: fp(2), CoordsFetchedAt: future, Source: "google"}, false},
		{"google fetched_at without coords", models.Place{PlaceID: "ChIJ1", CoordsFetchedAt: fresh, Source: "google"}, false},
		{"google only lat", models.Place{PlaceID: "ChIJ1", Lat: fp(1), CoordsFetchedAt: fresh, Source: "google"}, false},
		{"google lat out of range", models.Place{PlaceID: "ChIJ1", Lat: fp(91), Lng: fp(2), CoordsFetchedAt: fresh, Source: "google"}, false},
		{"google place_id too long", models.Place{PlaceID: string(long), Source: "google"}, false},
		{"google bad tz", models.Place{PlaceID: "ChIJ1", TZ: "Mars/Olympus", Source: "google"}, false},
		{"pin ok", models.Place{Name: "Pin", Address: "somewhere", Lat: fp(1), Lng: fp(2), TZ: "Asia/Tokyo", Source: "pin"}, true},
		{"manual ok", models.Place{Name: "Home", Lat: fp(1), Lng: fp(2), Source: "manual"}, true},
		{"manual old tz/coords are fine", models.Place{Name: "Home", Lat: fp(0), Lng: fp(0), Source: "manual"}, true},
		{"manual needs name", models.Place{Lat: fp(1), Lng: fp(2), Source: "manual"}, false},
		{"manual needs coords", models.Place{Name: "Home", Source: "manual"}, false},
		{"manual with place_id", models.Place{Name: "Home", PlaceID: "x", Lat: fp(1), Lng: fp(2), Source: "manual"}, false},
		{"manual with fetched_at", models.Place{Name: "Home", Lat: fp(1), Lng: fp(2), CoordsFetchedAt: fresh, Source: "pin"}, false},
		{"photon is gone", models.Place{Name: "X", Lat: fp(1), Lng: fp(2), Source: "photon"}, false},
		{"empty source", models.Place{Name: "X", Lat: fp(1), Lng: fp(2)}, false},
	}
	for _, c := range cases {
		p := c.p
		if got := validPlace(&p, now); got != c.ok {
			t.Errorf("%s: got %v want %v", c.name, got, c.ok)
		}
	}
	if !validPlace(nil, now) {
		t.Errorf("nil place is valid")
	}
}

func googlePlace(h *harness, id string, ageDays int, tz string) map[string]any {
	m := map[string]any{
		"place_id": id, "lat": 35.0, "lng": 135.0, "source": "google",
		"coords_fetched_at": h.now.Add(-time.Duration(ageDays) * 24 * time.Hour).UTC().Format(time.RFC3339),
	}
	if tz != "" {
		m["tz"] = tz
	}
	return m
}

func TestGooglePlacesThroughEveryPlaceSlot(t *testing.T) {
	h := newTripH(t)
	g := func(id string) map[string]any { return googlePlace(h, id, 1, "Asia/Tokyo") }
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"destination": g("d"), "stops": []any{g("s1")}}, t0+10), models.OpApplied, "")
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(2), map[string]any{"title": "", "place": map[string]any{"name": "H", "lat": 1.0, "lng": 2.0, "source": "manual"}}, t0+11), models.OpRejected, models.CodeInvalid)
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(2), map[string]any{"title": "  "}, t0+11), models.OpRejected, models.CodeInvalid)
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(2), map[string]any{"title": "", "place": g("blank")}, t0+11), models.OpApplied, "") // title stays blank for a Google place
	mustStatus(t, h.do("dev-a", TypeTodoUpdate, todoID(2), map[string]any{"place": nil}, t0+11), models.OpRejected, models.CodeInvalid)    // would leave a blank title with no Google place
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "Temple", "place": g("t")}, t0+12), models.OpApplied, "")
	mustStatus(t, h.do("dev-a", TypeTodoUpdate, todoID(1), map[string]any{"title": ""}, t0+13), models.OpApplied, "")
	mustStatus(t, h.do("dev-a", TypeTodoUpdate, todoID(1), map[string]any{"title": "Temple"}, t0+14), models.OpApplied, "")
	mustStatus(t, h.do("dev-a", TypeBookingCreate, bookingID(1), map[string]any{"kind": "flight", "title": "NH", "place": g("a"), "end_place": g("b")}, t0+13), models.OpApplied, "")

	bad := g("x")
	bad["name"] = "Kyoto Station"
	for _, patch := range []struct {
		typ, ent string
		p        map[string]any
	}{
		{TypeTripUpdate, "", map[string]any{"destination": bad}},
		{TypeTripUpdate, "", map[string]any{"stops": []any{bad}}},
		{TypeTodoUpdate, todoID(1), map[string]any{"place": bad}},
		{TypeBookingUpdate, bookingID(1), map[string]any{"place": bad}},
		{TypeBookingUpdate, bookingID(1), map[string]any{"end_place": bad}},
	} {
		mustStatus(t, h.do("dev-a", patch.typ, patch.ent, patch.p, t0+100), models.OpRejected, models.CodeInvalid)
	}
	stale := googlePlace(h, "x", 31, "")
	mustStatus(t, h.do("dev-a", TypeTodoUpdate, todoID(1), map[string]any{"place": stale}, t0+101), models.OpRejected, models.CodeInvalid)

	if h.trip.CoordsExpireAt == nil || !h.trip.CoordsExpireAt.Equal(h.now.Add(-24*time.Hour).Add(models.CoordsMaxAge).UTC()) {
		t.Fatalf("coords expiry: %v", h.trip.CoordsExpireAt)
	}
}

func TestGoogleTZDerivedFromCoordsWhenMissing(t *testing.T) {
	h := newTripH(t)
	calls := 0
	h.tz = func(lat, lng float64) string { calls++; return "Asia/Tokyo" }
	mustStatus(t, h.do("dev-a", TypeBookingCreate, bookingID(1), map[string]any{
		"kind": "flight", "title": "NH", "place": googlePlace(h, "a", 1, ""), "end_place": googlePlace(h, "b", 1, "Europe/Lisbon"),
	}, t0+10), models.OpApplied, "")
	b := h.trip.Bookings[0]
	if b.Place.TZ != "Asia/Tokyo" || b.EndPlace.TZ != "Europe/Lisbon" || calls != 1 {
		t.Fatalf("tz fill: place=%q end=%q calls=%d", b.Place.TZ, b.EndPlace.TZ, calls)
	}
	if b.EndTZ == nil || *b.EndTZ != "Europe/Lisbon" {
		t.Fatalf("end_tz should follow the client-sent zone")
	}
	// manual/pin places are never derived
	calls = 0
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"destination": map[string]any{"name": "Home", "lat": 1.0, "lng": 2.0, "source": "manual"}}, t0+11), models.OpApplied, "")
	if calls != 0 || h.trip.Destination.TZ != "" {
		t.Fatalf("manual place must not be derived (calls=%d)", calls)
	}
}

func buildStaleTrip(h *harness) {
	old := h.now.Add(-31 * 24 * time.Hour)
	fresh := h.now.Add(-24 * time.Hour)
	t := h.trip
	t.Version, t.V = 5, 3
	t.Destination = &models.Place{PlaceID: "d", Lat: fp(1), Lng: fp(2), TZ: "Asia/Tokyo", CoordsFetchedAt: &old, Source: "google"}
	t.Stops = []models.Place{
		{PlaceID: "s1", Lat: fp(1), Lng: fp(2), CoordsFetchedAt: &fresh, Source: "google"},
		{PlaceID: "s2", Lat: fp(1), Lng: fp(2), CoordsFetchedAt: &old, Source: "google"},
	}
	t.Todos = []models.TripTodo{
		{TodoID: "ttd_1", V: 2, Place: &models.Place{PlaceID: "t1", Lat: fp(1), Lng: fp(2), CoordsFetchedAt: &old, Source: "google"}},
		{TodoID: "ttd_2", V: 2, Place: &models.Place{PlaceID: "t2", Lat: fp(1), Lng: fp(2), CoordsFetchedAt: &fresh, Source: "google"}},
		{TodoID: "ttd_3", V: 2, Place: &models.Place{Name: "Home", Lat: fp(1), Lng: fp(2), Source: "manual"}},
	}
	t.Bookings = []models.Booking{
		{BookingID: "tbk_1", V: 2, Place: &models.Place{PlaceID: "b1", Lat: fp(1), Lng: fp(2), CoordsFetchedAt: &fresh, Source: "google"},
			EndPlace: &models.Place{PlaceID: "b2", Lat: fp(1), Lng: fp(2), CoordsFetchedAt: &old, Source: "google"}},
	}
	RecomputeCoordsExpiry(t)
}

func TestPurgeStaleCoords(t *testing.T) {
	h := newTripH(t)
	buildStaleTrip(h)
	if h.trip.CoordsExpireAt == nil || !h.trip.CoordsExpireAt.Before(h.now) {
		t.Fatalf("expiry should already be due: %v", h.trip.CoordsExpireAt)
	}
	tr := h.trip.Clone()
	origDest := tr.Destination
	if !PurgeStaleCoords(tr, h.now) {
		t.Fatal("expected a change")
	}
	if tr.Version != 6 || tr.V != 6 {
		t.Fatalf("version=%d v=%d", tr.Version, tr.V)
	}
	// destination: coords gone, id and tz kept; the original object is untouched
	if d := tr.Destination; d.Lat != nil || d.Lng != nil || d.CoordsFetchedAt != nil || d.PlaceID != "d" || d.TZ != "Asia/Tokyo" {
		t.Fatalf("destination: %+v", d)
	}
	if origDest.Lat == nil {
		t.Fatalf("purge mutated a shared place")
	}
	if tr.Stops[0].Lat == nil || tr.Stops[1].Lat != nil || tr.Stops[1].PlaceID != "s2" {
		t.Fatalf("stops: %+v", tr.Stops)
	}
	if h.trip.Stops[1].Lat == nil {
		t.Fatalf("purge mutated the original stops slice")
	}
	// only the stale todo/booking are bumped and attributed to the system
	if td := tr.Todos[0]; td.Place.Lat != nil || td.V != 6 || td.UpdatedBy != models.SystemActor || td.UpdatedAt == nil {
		t.Fatalf("stale todo: %+v", td)
	}
	if tr.Todos[1].V != 2 || tr.Todos[1].Place.Lat == nil || tr.Todos[2].V != 2 || tr.Todos[2].Place.Lat == nil {
		t.Fatalf("fresh/manual todos must be untouched")
	}
	bk := tr.Bookings[0]
	if bk.EndPlace.Lat != nil || bk.Place.Lat == nil || bk.V != 6 || bk.UpdatedBy != models.SystemActor {
		t.Fatalf("booking: %+v", bk)
	}
	// clients get a delta
	d := DeltaSince(tr, 5, true)
	if d.Trip == nil || len(d.Todos) != 1 || len(d.Bookings) != 1 || d.Todos[0].TodoID != "ttd_1" {
		t.Fatalf("delta: %+v", d)
	}
	// expiry now points at the remaining fresh coordinates
	if tr.CoordsExpireAt == nil || !tr.CoordsExpireAt.After(h.now) {
		t.Fatalf("expiry not advanced: %v", tr.CoordsExpireAt)
	}
	// idempotent
	if PurgeStaleCoords(tr, h.now) || tr.Version != 6 {
		t.Fatalf("second purge must be a no-op (version %d)", tr.Version)
	}
}

func TestPurgeClearsExpiryWhenNothingLeft(t *testing.T) {
	h := newTripH(t)
	old := h.now.Add(-40 * 24 * time.Hour)
	h.trip.Version = 2
	h.trip.Destination = &models.Place{PlaceID: "d", Lat: fp(1), Lng: fp(2), CoordsFetchedAt: &old, Source: "google"}
	RecomputeCoordsExpiry(h.trip)
	if !PurgeStaleCoords(h.trip, h.now) || h.trip.CoordsExpireAt != nil {
		t.Fatalf("expiry should clear: %v", h.trip.CoordsExpireAt)
	}
	if PurgeStaleCoords(h.trip, h.now) {
		t.Fatalf("not idempotent")
	}
}

func TestExpiryTrackedAcrossOps(t *testing.T) {
	h := newTripH(t)
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"destination": googlePlace(h, "d", 10, "")}, t0+10), models.OpApplied, "")
	if h.trip.CoordsExpireAt == nil {
		t.Fatal("expiry not set")
	}
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"destination": nil}, t0+20), models.OpApplied, "")
	if h.trip.CoordsExpireAt != nil {
		t.Fatalf("expiry should clear with the place: %v", h.trip.CoordsExpireAt)
	}
}
