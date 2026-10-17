package trips

import (
	"bytes"
	"encoding/json"
	"math"
	"regexp"
	"strings"
	"time"
	_ "time/tzdata" // alpine images ship no zoneinfo
	"unicode/utf8"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

const (
	TypeTripCreate        = "trip.create"
	TypeTripUpdate        = "trip.update"
	TypeTripDelete        = "trip.delete"
	TypeTripRestore       = "trip.restore"
	TypeTodoCreate        = "todo.create"
	TypeTodoUpdate        = "todo.update"
	TypeTodoDelete        = "todo.delete"
	TypeBookingCreate     = "booking.create"
	TypeBookingUpdate     = "booking.update"
	TypeBookingDelete     = "booking.delete"
	MaxTodos              = 150
	MaxBookings           = 50
	maxTripTitle          = 120
	maxItemTitle          = 200
	maxTripNotes          = 16384
	maxUserID             = 64
	maxItemNotes          = 2048
	maxConfirmation       = 64
	MaxStops              = 12
	MaxTravellers         = 20
	MaxDays               = 60
	maxDayLabel           = 40
	MaxDayClocks          = 4 * MaxDays // live labels plus recently removed ones awaiting clock pruning
	MaxAckedClients       = 200
	MaxNewClientsPerBatch = 3
	maxLocality           = 120
)

var (
	reTrip    = regexp.MustCompile(`^trip_[0-9a-f]{32}$`)
	reTodo    = regexp.MustCompile(`^ttd_[0-9a-f]{32}$`)
	reBooking = regexp.MustCompile(`^tbk_[0-9a-f]{32}$`)
	reToken   = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

	categories   = map[string]bool{"food": true, "sight": true, "activity": true, "transport": true, "stay": true, "shopping": true, "other": true}
	bookingKinds = map[string]bool{"flight": true, "stay": true, "train": true, "car": true, "ticket": true, "other": true}
	tripIcons    = map[string]bool{"SUITCASE": true, "PLANE": true, "BEACH": true, "MOUNTAIN": true, "CITY": true, "TRAIN": true,
		"ROAD_TRIP": true, "CAMPING": true, "MAP": true, "LANDMARK": true, "WINE": true, "SKI": true}
	placeSources = map[string]bool{models.SourceGoogle: true, models.SourcePin: true, models.SourceManual: true}
)

func okTitle(s string, max int) bool {
	return utf8.RuneCountInString(strings.TrimSpace(s)) > 0 && utf8.RuneCountInString(s) <= max
}
func okBytes(s string, max int) bool { return len(s) <= max }

func validDate(s string) bool {
	_, err := time.Parse("2006-01-02", s)
	return err == nil
}
func validClock(s string) bool {
	_, err := time.Parse("15:04", s)
	return err == nil
}
func validDateTime(s string) bool {
	_, err := time.Parse("2006-01-02T15:04", s)
	return err == nil
}
func validTZ(s string) bool {
	if s == "" || s == "Local" {
		return false
	}
	_, err := time.LoadLocation(s)
	return err == nil
}

// clockSkew tolerates a client clock slightly ahead of the server when stamping coords_fetched_at.
const clockSkew = 5 * time.Minute

// validPlace enforces the Google Maps Platform storage rules (see models.Place).
func validPlace(p *models.Place, now time.Time) bool {
	if p == nil {
		return true
	}
	if !placeSources[p.Source] || len(p.PlaceID) > 256 ||
		utf8.RuneCountInString(p.Name) > 200 || utf8.RuneCountInString(p.Address) > 300 ||
		utf8.RuneCountInString(p.Locality) > maxLocality || (p.TZ != "" && !validTZ(p.TZ)) {
		return false
	}
	if (p.Lat == nil) != (p.Lng == nil) {
		return false
	}
	hasCoords := p.Lat != nil
	if hasCoords {
		lat, lng := *p.Lat, *p.Lng
		if math.IsNaN(lat) || math.IsNaN(lng) || math.IsInf(lat, 0) || math.IsInf(lng, 0) ||
			lat < -90 || lat > 90 || lng < -180 || lng > 180 {
			return false
		}
	}
	if p.Source != models.SourceGoogle {
		// user content: a name and coordinates are required, Google fields are not allowed
		return p.PlaceID == "" && p.CoordsFetchedAt == nil && hasCoords && okTitle(p.Name, 200)
	}
	if p.PlaceID == "" || p.Name != "" || p.Address != "" {
		return false // Google names and addresses may not be stored
	}
	if !hasCoords {
		return p.CoordsFetchedAt == nil // purged / never fetched: only place_id and tz remain
	}
	f := p.CoordsFetchedAt
	return f != nil && !f.After(now.Add(clockSkew)) && now.Sub(*f) <= models.CoordsMaxAge
}

// optOK validates an Opt[string] with fn when it carries a value (null clears and is always fine).
func optOK(o Opt[string], fn func(string) bool) bool {
	return !o.Set || o.Val == nil || fn(*o.Val)
}

func validTripPatch(p TripPatch, create bool, now time.Time) bool {
	if create && p.Title == nil {
		return false
	}
	if p.Title != nil && !okTitle(*p.Title, maxTripTitle) {
		return false
	}
	if p.Destination.Set && !validPlace(p.Destination.Val, now) {
		return false
	}
	if p.Notes != nil && !okBytes(*p.Notes, maxTripNotes) {
		return false
	}
	if !optOK(p.StartDate, validDate) || !optOK(p.EndDate, validDate) {
		return false
	}
	if p.Stops.Set && p.Stops.Val != nil {
		for i := range *p.Stops.Val {
			pl := (*p.Stops.Val)[i]
			if pl.Source == "" || !validPlace(&pl, now) {
				return false
			}
		}
	}
	if p.Travellers.Set && p.Travellers.Val != nil && !validTravellers(*p.Travellers.Val) {
		return false
	}
	if len(p.Days) > MaxDays {
		return false
	}
	for date, label := range p.Days {
		if !validDate(date) || utf8.RuneCountInString(label) > maxDayLabel {
			return false
		}
	}
	if p.Icon != nil && *p.Icon != "" && !tripIcons[*p.Icon] {
		return false
	}
	return p.TZ == nil || validTZ(*p.TZ)
}

// validTravellers checks shape only (cap, no blanks or duplicates). Whether the IDs are members
// of the house is checked by the service, which knows the house.
func validTravellers(ids []string) bool {
	if len(ids) > MaxTravellers {
		return false
	}
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if id == "" || len(id) > maxUserID || seen[id] {
			return false
		}
		seen[id] = true
	}
	return true
}

func validTodoPatch(p TodoPatch, create bool, now time.Time) bool {
	if create && p.Title == nil {
		return false
	}
	// A blank title is allowed here (a Google place can stand in for one); the apply step
	// requires a non-blank title unless the todo has a Google place.
	if p.Title != nil && utf8.RuneCountInString(*p.Title) > maxItemTitle {
		return false
	}
	if !optOK(p.Day, validDate) || !optOK(p.StartTime, validClock) ||
		!optOK(p.BookingID, reBooking.MatchString) {
		return false
	}
	if p.DurationMin.Set && p.DurationMin.Val != nil && (*p.DurationMin.Val < 1 || *p.DurationMin.Val > 1440) {
		return false
	}
	if p.Order != nil && (math.IsNaN(*p.Order) || math.IsInf(*p.Order, 0) || math.Abs(*p.Order) > 1e12) {
		return false
	}
	if p.Category != nil && !categories[*p.Category] {
		return false
	}
	if p.Notes != nil && !okBytes(*p.Notes, maxItemNotes) {
		return false
	}
	return !p.Place.Set || validPlace(p.Place.Val, now)
}

func validBookingPatch(p BookingPatch, create bool, now time.Time) bool {
	if create && (p.Kind == nil || p.Title == nil) {
		return false
	}
	if p.Kind != nil && !bookingKinds[*p.Kind] {
		return false
	}
	if p.Title != nil && !okTitle(*p.Title, maxItemTitle) {
		return false
	}
	if p.ConfirmationCode != nil && utf8.RuneCountInString(*p.ConfirmationCode) > maxConfirmation {
		return false
	}
	if !optOK(p.StartsAt, validDateTime) || !optOK(p.EndsAt, validDateTime) ||
		!optOK(p.StartTZ, validTZ) || !optOK(p.EndTZ, validTZ) {
		return false
	}
	if p.Notes != nil && !okBytes(*p.Notes, maxItemNotes) {
		return false
	}
	return (!p.Place.Set || validPlace(p.Place.Val, now)) && (!p.EndPlace.Set || validPlace(p.EndPlace.Val, now))
}

var knownTypes = map[string]bool{
	TypeTripCreate: true, TypeTripUpdate: true, TypeTripDelete: true, TypeTripRestore: true,
	TypeTodoCreate: true, TypeTodoUpdate: true, TypeTodoDelete: true,
	TypeBookingCreate: true, TypeBookingUpdate: true, TypeBookingDelete: true,
}

// ValidateEnvelope checks everything about an op except its patch. Returns "" or a rejection code.
func ValidateEnvelope(op models.Op) string {
	if op.V != 1 || !knownTypes[op.Type] {
		return models.CodeUnsupported
	}
	if !reToken.MatchString(op.OpID) || !reToken.MatchString(op.ClientID) ||
		op.Seq < 1 || op.At < 1 || !reTrip.MatchString(op.TripID) {
		return models.CodeInvalid
	}
	switch {
	case strings.HasPrefix(op.Type, "todo."):
		if !reTodo.MatchString(op.EntityID) {
			return models.CodeInvalid
		}
	case strings.HasPrefix(op.Type, "booking."):
		if !reBooking.MatchString(op.EntityID) {
			return models.CodeInvalid
		}
	default:
		if op.EntityID != "" {
			return models.CodeInvalid
		}
	}
	return ""
}

// DecodeOp strictly decodes one op. When ok is false, res is the rejection to return for it.
func DecodeOp(raw json.RawMessage) (op models.Op, res models.OpResult, ok bool) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&op); err != nil {
		res = models.OpResult{Status: models.OpRejected, Code: models.CodeInvalid}
		if strings.HasPrefix(err.Error(), "json: unknown field") {
			res.Code = models.CodeUnsupported
		}
		var probe struct {
			OpID string `json:"op_id"`
		}
		_ = json.Unmarshal(raw, &probe)
		res.OpID = probe.OpID
		return op, res, false
	}
	if code := ValidateEnvelope(op); code != "" {
		return op, models.OpResult{OpID: op.OpID, Status: models.OpRejected, Code: code}, false
	}
	return op, models.OpResult{}, true
}
