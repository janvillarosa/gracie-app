package trips

import (
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

const (
	tombstoneTTL = 30 * 24 * time.Hour
	trashTTL     = 30 * 24 * time.Hour
)

// Ctx carries per-batch context into ApplyOp.
type Ctx struct {
	Actor string    // user performing the batch
	Now   time.Time // server time
	NewV  int64     // version this batch will write (current Version + 1)
	// TZ derives an IANA zone from coordinates for Google places that arrive without one.
	// Optional (nil = leave tz empty); it must be cheap to call and safe to call concurrently.
	TZ func(lat, lng float64) string
	// Members are the house's current members. When set, travellers must be among them (the
	// service passes them; nil skips the check, the engine itself does not know the house).
	Members []string
}

// travellersKnown reports whether every traveller in the patch is a current member.
func (c Ctx) travellersKnown(p TripPatch) bool {
	if c.Members == nil || !p.Travellers.Set || p.Travellers.Val == nil {
		return true
	}
	for _, id := range *p.Travellers.Val {
		if !slices.Contains(c.Members, id) {
			return false
		}
	}
	return true
}

// Outcome tells the caller what to persist.
type Outcome struct {
	Dirty bool // the trip changed in some way (at least acked) and must be written
	Bump  bool // data changed; t.Version has been set to Ctx.NewV
}

// stamp returns the batch's server time (UTC) for updated_at.
func stamp(c Ctx) *time.Time {
	n := c.Now.UTC()
	return &n
}

// NewShell returns an empty, not-yet-persisted trip (Version 0) for trip.create.
func NewShell(tripID, roomID, actor string, now time.Time) *models.Trip {
	return &models.Trip{
		TripID: tripID, RoomID: roomID, CreatedBy: actor, CreatedAt: now, UpdatedAt: now,
		FieldAt: map[string]int64{}, Acked: map[string]int64{},
	}
}

func fail(res *models.OpResult, code string) bool {
	res.Status = models.OpRejected
	res.Code = code
	return false
}

// change is one clocked field assignment.
type change struct {
	name  string
	apply func()
}

// commit applies each change whose clock is not newer than at. Skipped fields mark
// the result conflicted. It reports whether anything was applied.
func commit(clock *map[string]int64, at int64, changes []change, res *models.OpResult) bool {
	if *clock == nil {
		*clock = map[string]int64{}
	}
	applied := false
	for _, ch := range changes {
		if at < (*clock)[ch.name] {
			res.SkippedFields = append(res.SkippedFields, ch.name)
			continue
		}
		ch.apply()
		(*clock)[ch.name] = at
		applied = true
	}
	if len(res.SkippedFields) > 0 {
		res.Status = models.OpConflicted
	}
	return applied
}

// ApplyOp applies one op to t in memory. It never does I/O. The caller persists t
// when the returned Outcome is Dirty (insert for a new shell, compare-and-swap otherwise).
func ApplyOp(t *models.Trip, op models.Op, c Ctx) (models.OpResult, Outcome) {
	res := models.OpResult{OpID: op.OpID, Status: models.OpApplied}
	if code := ValidateEnvelope(op); code != "" {
		fail(&res, code)
		return res, Outcome{}
	}
	if op.Seq <= t.Acked[op.ClientID] {
		res.Status = models.OpDuplicate
		return res, Outcome{}
	}
	if t.Version == 0 && op.Type != TypeTripCreate {
		fail(&res, models.CodeForbiddenOrUnknown)
		return res, Outcome{}
	}
	if _, known := t.Acked[op.ClientID]; !known && len(t.Acked) >= MaxAckedClients {
		fail(&res, models.CodeCap) // bounded document: too many distinct devices; seq not consumed
		return res, Outcome{}
	}
	at := op.At
	if ms := c.Now.UnixMilli(); at > ms {
		at = ms // a skewed phone clock must not win forever
	}
	bump := dispatch(t, op, at, c, &res)
	if t.Acked == nil {
		t.Acked = map[string]int64{}
	}
	t.Acked[op.ClientID] = op.Seq // every non-duplicate outcome consumes the seq
	if t.AckedAt == nil {
		t.AckedAt = map[string]int64{}
	}
	t.AckedAt[op.ClientID] = c.Now.UnixMilli()
	if bump {
		t.Version = c.NewV
		RecomputeCoordsExpiry(t)
	}
	return res, Outcome{Dirty: true, Bump: bump}
}

func dispatch(t *models.Trip, op models.Op, at int64, c Ctx, res *models.OpResult) bool {
	if t.DeletedAt != nil && op.Type != TypeTripRestore {
		return fail(res, models.CodeGone)
	}
	switch op.Type {
	case TypeTripCreate:
		return tripCreate(t, op, at, c, res)
	case TypeTripUpdate:
		return tripUpdate(t, op, at, c, res)
	case TypeTripDelete:
		return tripDelete(t, at, c, res)
	case TypeTripRestore:
		return tripRestore(t, at, res)
	case TypeTodoCreate:
		return todoCreate(t, op, at, c, res)
	case TypeTodoUpdate:
		return todoUpdate(t, op, at, c, res)
	case TypeTodoDelete:
		return todoDelete(t, op, c, res)
	case TypeBookingCreate:
		return bookingCreate(t, op, at, c, res)
	case TypeBookingUpdate:
		return bookingUpdate(t, op, at, c, res)
	case TypeBookingDelete:
		return bookingDelete(t, op, c, res)
	}
	return fail(res, models.CodeUnsupported)
}

// pick returns the effective value of a date field after a patch.
func pick(o Opt[string], cur *string) *string {
	if o.Set {
		return o.Val
	}
	return cur
}

// datesOrdered reports whether end >= start (ISO dates compare lexicographically).
func datesOrdered(start, end *string) bool {
	return start == nil || end == nil || *end >= *start
}

func tripChanges(t *models.Trip, p TripPatch) []change {
	var ch []change
	if p.Title != nil {
		v := *p.Title
		ch = append(ch, change{"title", func() { t.Title = v }})
	}
	if p.Destination.Set {
		v := p.Destination.Val
		ch = append(ch, change{"destination", func() { t.Destination = v }})
	}
	if p.Notes != nil {
		v := *p.Notes
		ch = append(ch, change{"notes", func() { t.Notes = v }})
	}
	if p.StartDate.Set {
		v := p.StartDate.Val
		ch = append(ch, change{"start_date", func() { t.StartDate = v }})
	}
	if p.EndDate.Set {
		v := p.EndDate.Val
		ch = append(ch, change{"end_date", func() { t.EndDate = v }})
	}
	if p.TZ != nil {
		v := *p.TZ
		ch = append(ch, change{"tz", func() { t.TZ = v }})
	}
	if p.Icon != nil {
		v := *p.Icon
		ch = append(ch, change{"icon", func() { t.Icon = v }})
	}
	if p.Stops.Set {
		var v []models.Place
		if p.Stops.Val != nil {
			v = append(v, *p.Stops.Val...)
		}
		ch = append(ch, change{"stops", func() { t.Stops = v }})
	}
	if p.Travellers.Set {
		var v []string
		if p.Travellers.Val != nil && len(*p.Travellers.Val) > 0 {
			v = append(v, *p.Travellers.Val...)
		}
		ch = append(ch, change{"travellers", func() { t.Travellers = v }})
	}
	dates := make([]string, 0, len(p.Days))
	for d := range p.Days {
		dates = append(dates, d)
	}
	sort.Strings(dates)
	for _, d := range dates {
		date, label := d, p.Days[d]
		ch = append(ch, change{"days." + date, func() {
			if label == "" {
				delete(t.Days, date)
				if len(t.Days) == 0 {
					t.Days = nil
				}
				return
			}
			if t.Days == nil {
				t.Days = map[string]string{}
			}
			t.Days[date] = label
		}})
	}
	return ch
}

// tripCapExceeded reports whether the patch would push stops or day labels over their caps.
func tripCapExceeded(t *models.Trip, p TripPatch) bool {
	if p.Stops.Set && p.Stops.Val != nil && len(*p.Stops.Val) > MaxStops {
		return true
	}
	labels, clocks := len(t.Days), 0
	for k := range t.FieldAt {
		if strings.HasPrefix(k, "days.") {
			clocks++
		}
	}
	for d, label := range p.Days {
		_, exists := t.Days[d]
		switch {
		case label != "" && !exists:
			labels++
		case label == "" && exists:
			labels--
		}
		if _, has := t.FieldAt["days."+d]; !has {
			clocks++
		}
	}
	return labels > MaxDays || clocks > MaxDayClocks
}

func tripCreate(t *models.Trip, op models.Op, at int64, c Ctx, res *models.OpResult) bool {
	if t.Version != 0 {
		return fail(res, models.CodeForbiddenOrUnknown)
	}
	var p TripPatch
	if code := decodePatch(op.Patch, &p); code != "" {
		return fail(res, code)
	}
	if !validTripPatch(p, true, c.Now) || !datesOrdered(pick(p.StartDate, nil), pick(p.EndDate, nil)) || !c.travellersKnown(p) {
		return fail(res, models.CodeInvalid)
	}
	if tripCapExceeded(t, p) {
		return fail(res, models.CodeCap)
	}
	fillTripTZ(&p, c)
	commit(&t.FieldAt, at, tripChanges(t, p), res)
	if t.TZ == "" && t.Destination != nil {
		t.TZ = t.Destination.TZ // taken from the destination once, then only explicit edits change it
	}
	t.V = c.NewV
	return true
}

func tripUpdate(t *models.Trip, op models.Op, at int64, c Ctx, res *models.OpResult) bool {
	var p TripPatch
	if code := decodePatch(op.Patch, &p); code != "" {
		return fail(res, code)
	}
	if !validTripPatch(p, false, c.Now) || !datesOrdered(pick(p.StartDate, t.StartDate), pick(p.EndDate, t.EndDate)) || !c.travellersKnown(p) {
		return fail(res, models.CodeInvalid)
	}
	if tripCapExceeded(t, p) {
		return fail(res, models.CodeCap)
	}
	fillTripTZ(&p, c)
	if !commit(&t.FieldAt, at, tripChanges(t, p), res) {
		return false
	}
	t.V = c.NewV
	return true
}

func tripDelete(t *models.Trip, at int64, c Ctx, res *models.OpResult) bool {
	return commit(&t.FieldAt, at, []change{{"deleted", func() {
		d := c.Now
		p := c.Now.Add(trashTTL)
		t.DeletedAt, t.DeletedBy, t.PurgeAt = &d, c.Actor, &p
	}}}, res)
}

func tripRestore(t *models.Trip, at int64, res *models.OpResult) bool {
	if t.DeletedAt == nil {
		return false // already live: idempotent no-op
	}
	return commit(&t.FieldAt, at, []change{{"deleted", func() {
		t.DeletedAt, t.DeletedBy, t.PurgeAt = nil, "", nil
	}}}, res)
}

const (
	orderStep   = 1000.0
	minOrderGap = 1e-7
)

func findTodo(t *models.Trip, id string) int {
	for i := range t.Todos {
		if t.Todos[i].TodoID == id {
			return i
		}
	}
	return -1
}

func tombstoned(t *models.Trip, id string) bool {
	for _, ts := range t.Tombstones {
		if ts.ID == id {
			return true
		}
	}
	return false
}

// resolveTodoTZ stores the effective zone at write time: place.tz, else the trip's.
func resolveTodoTZ(t *models.Trip, td *models.TripTodo) {
	if td.Place != nil && td.Place.TZ != "" {
		td.TZ = td.Place.TZ
		return
	}
	td.TZ = t.TZ
}

func dayKey(d *string) string {
	if d == nil {
		return ""
	}
	return *d
}

func nextOrder(t *models.Trip, day *string) float64 {
	max, any := 0.0, false
	for i := range t.Todos {
		if dayKey(t.Todos[i].Day) == dayKey(day) && (!any || t.Todos[i].Order > max) {
			max, any = t.Todos[i].Order, true
		}
	}
	if !any {
		return orderStep
	}
	return max + orderStep
}

// renumberIfCramped re-spaces any day group (or Ideas) whose neighbours are closer than
// minOrderGap (including equal orders from two offline inserts). Ties break by todo_id.
func renumberIfCramped(t *models.Trip, newV int64) {
	groups := map[string][]int{}
	for i := range t.Todos {
		k := dayKey(t.Todos[i].Day)
		groups[k] = append(groups[k], i)
	}
	for _, idx := range groups {
		sort.Slice(idx, func(a, b int) bool {
			x, y := &t.Todos[idx[a]], &t.Todos[idx[b]]
			if x.Order != y.Order {
				return x.Order < y.Order
			}
			return x.TodoID < y.TodoID
		})
		cramped := false
		for k := 1; k < len(idx); k++ {
			if t.Todos[idx[k]].Order-t.Todos[idx[k-1]].Order < minOrderGap {
				cramped = true
				break
			}
		}
		if !cramped {
			continue
		}
		for k, i := range idx {
			t.Todos[i].Order = float64(k+1) * orderStep
			t.Todos[i].V = newV
		}
	}
}

func todoChanges(td *models.TripTodo, p TodoPatch, actor string, now time.Time) []change {
	var ch []change
	if p.Title != nil {
		v := *p.Title
		ch = append(ch, change{"title", func() { td.Title = v }})
	}
	if p.Done != nil {
		d := *p.Done
		ch = append(ch, change{"done", func() {
			td.Done = d
			if d {
				n := now
				td.DoneBy, td.DoneAt = actor, &n
			} else {
				td.DoneBy, td.DoneAt = "", nil
			}
		}})
	}
	if p.Day.Set {
		v := p.Day.Val
		ch = append(ch, change{"day", func() { td.Day = v }})
	}
	if p.StartTime.Set {
		v := p.StartTime.Val
		ch = append(ch, change{"start_time", func() { td.StartTime = v }})
	}
	if p.DurationMin.Set {
		v := p.DurationMin.Val
		ch = append(ch, change{"duration_min", func() { td.DurationMin = v }})
	}
	if p.Order != nil {
		v := *p.Order
		ch = append(ch, change{"order", func() { td.Order = v }})
	}
	if p.Category != nil {
		v := *p.Category
		ch = append(ch, change{"category", func() { td.Category = v }})
	}
	if p.Notes != nil {
		v := *p.Notes
		ch = append(ch, change{"notes", func() { td.Notes = v }})
	}
	if p.Place.Set {
		v := p.Place.Val
		ch = append(ch, change{"place", func() { td.Place = v }})
	}
	if p.BookingID.Set {
		v := p.BookingID.Val
		ch = append(ch, change{"booking_id", func() { td.BookingID = v }})
	}
	return ch
}

// bookingLinkOK reports whether a patch's booking_id (when set to a value) names a live
// booking of this trip. Deleted bookings are removed from t.Bookings, so tombstoned ids fail too.
func bookingLinkOK(t *models.Trip, p TodoPatch) bool {
	return !p.BookingID.Set || p.BookingID.Val == nil || findBooking(t, *p.BookingID.Val) >= 0
}

func todoCreate(t *models.Trip, op models.Op, at int64, c Ctx, res *models.OpResult) bool {
	if tombstoned(t, op.EntityID) {
		return fail(res, models.CodeGone)
	}
	if len(t.Todos) >= MaxTodos {
		return fail(res, models.CodeCap)
	}
	if findTodo(t, op.EntityID) >= 0 {
		return fail(res, models.CodeInvalid)
	}
	var p TodoPatch
	if code := decodePatch(op.Patch, &p); code != "" {
		return fail(res, code)
	}
	if !validTodoPatch(p, true, c.Now) || !bookingLinkOK(t, p) || !todoTitleOK(*p.Title, p.Place.Val) {
		return fail(res, models.CodeInvalid)
	}
	fillPlaceTZ(p.Place.Val, c)
	td := models.TripTodo{TodoID: op.EntityID, Category: "other", CreatedBy: c.Actor, UpdatedBy: c.Actor, UpdatedAt: stamp(c), FieldAt: map[string]int64{}}
	commit(&td.FieldAt, at, todoChanges(&td, p, c.Actor, c.Now), res)
	if p.Order == nil {
		td.Order = nextOrder(t, td.Day)
	}
	td.V = c.NewV
	resolveTodoTZ(t, &td)
	t.Todos = append(t.Todos, td)
	renumberIfCramped(t, c.NewV)
	return true
}

func todoUpdate(t *models.Trip, op models.Op, at int64, c Ctx, res *models.OpResult) bool {
	i := findTodo(t, op.EntityID)
	if i < 0 {
		return fail(res, models.CodeGone)
	}
	var p TodoPatch
	if code := decodePatch(op.Patch, &p); code != "" {
		return fail(res, code)
	}
	if !validTodoPatch(p, false, c.Now) || !bookingLinkOK(t, p) {
		return fail(res, models.CodeInvalid)
	}
	if p.Title != nil || p.Place.Set {
		title, place := t.Todos[i].Title, t.Todos[i].Place
		if p.Title != nil {
			title = *p.Title
		}
		if p.Place.Set {
			place = p.Place.Val
		}
		if !todoTitleOK(title, place) {
			return fail(res, models.CodeInvalid)
		}
	}
	fillPlaceTZ(p.Place.Val, c)
	td := &t.Todos[i]
	if !commit(&td.FieldAt, at, todoChanges(td, p, c.Actor, c.Now), res) {
		return false
	}
	td.V = c.NewV
	td.UpdatedBy, td.UpdatedAt = c.Actor, stamp(c)
	if p.Place.Set { // a title-only edit must not shift the time after a trip tz change
		resolveTodoTZ(t, td)
	}
	if p.Order != nil || p.Day.Set {
		renumberIfCramped(t, c.NewV)
	}
	return true
}

func todoDelete(t *models.Trip, op models.Op, c Ctx, res *models.OpResult) bool {
	i := findTodo(t, op.EntityID)
	if i < 0 {
		return false // already gone (tombstoned or never existed): idempotent
	}
	t.Todos = append(t.Todos[:i], t.Todos[i+1:]...)
	t.Tombstones = append(t.Tombstones, models.Tombstone{ID: op.EntityID, V: c.NewV, At: c.Now})
	return true
}

func findBooking(t *models.Trip, id string) int {
	for i := range t.Bookings {
		if t.Bookings[i].BookingID == id {
			return i
		}
	}
	return -1
}

func bookingChanges(b *models.Booking, p BookingPatch) []change {
	var ch []change
	if p.Kind != nil {
		v := *p.Kind
		ch = append(ch, change{"kind", func() { b.Kind = v }})
	}
	if p.Title != nil {
		v := *p.Title
		ch = append(ch, change{"title", func() { b.Title = v }})
	}
	if p.ConfirmationCode != nil {
		v := *p.ConfirmationCode
		ch = append(ch, change{"confirmation_code", func() { b.ConfirmationCode = v }})
	}
	if p.StartsAt.Set {
		v := p.StartsAt.Val
		ch = append(ch, change{"starts_at", func() { b.StartsAt = v }})
	}
	if p.EndsAt.Set {
		v := p.EndsAt.Val
		ch = append(ch, change{"ends_at", func() { b.EndsAt = v }})
	}
	if p.StartTZ.Set {
		v := p.StartTZ.Val
		ch = append(ch, change{"start_tz", func() { b.StartTZ = v }})
	}
	if p.EndTZ.Set {
		v := p.EndTZ.Val
		ch = append(ch, change{"end_tz", func() { b.EndTZ = v }})
	}
	if p.Place.Set {
		v := p.Place.Val
		ch = append(ch, change{"place", func() { b.Place = v }})
	}
	if p.EndPlace.Set {
		v := p.EndPlace.Val
		ch = append(ch, change{"end_place", func() { b.EndPlace = v }})
		// end_tz follows the arrival place unless the patch names it (start_tz is not derived).
		if !p.EndTZ.Set && v != nil && v.TZ != "" {
			tz := v.TZ
			ch = append(ch, change{"end_tz", func() { b.EndTZ = &tz }})
		}
	}
	if p.Notes != nil {
		v := *p.Notes
		ch = append(ch, change{"notes", func() { b.Notes = v }})
	}
	return ch
}

func bookingCreate(t *models.Trip, op models.Op, at int64, c Ctx, res *models.OpResult) bool {
	if tombstoned(t, op.EntityID) {
		return fail(res, models.CodeGone)
	}
	if len(t.Bookings) >= MaxBookings {
		return fail(res, models.CodeCap)
	}
	if findBooking(t, op.EntityID) >= 0 {
		return fail(res, models.CodeInvalid)
	}
	var p BookingPatch
	if code := decodePatch(op.Patch, &p); code != "" {
		return fail(res, code)
	}
	if !validBookingPatch(p, true, c.Now) {
		return fail(res, models.CodeInvalid)
	}
	fillPlaceTZ(p.Place.Val, c)
	fillPlaceTZ(p.EndPlace.Val, c)
	b := models.Booking{BookingID: op.EntityID, CreatedBy: c.Actor, UpdatedBy: c.Actor, UpdatedAt: stamp(c), FieldAt: map[string]int64{}}
	commit(&b.FieldAt, at, bookingChanges(&b, p), res)
	b.V = c.NewV
	t.Bookings = append(t.Bookings, b)
	return true
}

func bookingUpdate(t *models.Trip, op models.Op, at int64, c Ctx, res *models.OpResult) bool {
	i := findBooking(t, op.EntityID)
	if i < 0 {
		return fail(res, models.CodeGone)
	}
	var p BookingPatch
	if code := decodePatch(op.Patch, &p); code != "" {
		return fail(res, code)
	}
	if !validBookingPatch(p, false, c.Now) {
		return fail(res, models.CodeInvalid)
	}
	fillPlaceTZ(p.Place.Val, c)
	fillPlaceTZ(p.EndPlace.Val, c)
	b := &t.Bookings[i]
	if !commit(&b.FieldAt, at, bookingChanges(b, p), res) {
		return false
	}
	b.V = c.NewV
	b.UpdatedBy, b.UpdatedAt = c.Actor, stamp(c)
	return true
}

func bookingDelete(t *models.Trip, op models.Op, c Ctx, res *models.OpResult) bool {
	i := findBooking(t, op.EntityID)
	if i < 0 {
		return false
	}
	t.Bookings = append(t.Bookings[:i], t.Bookings[i+1:]...)
	t.Tombstones = append(t.Tombstones, models.Tombstone{ID: op.EntityID, V: c.NewV, At: c.Now})
	for k := range t.Todos { // cascade: no todo may point at a deleted booking
		if td := &t.Todos[k]; td.BookingID != nil && *td.BookingID == op.EntityID {
			td.BookingID = nil
			td.V = c.NewV
			td.UpdatedBy, td.UpdatedAt = c.Actor, stamp(c)
		}
	}
	return true
}

// fillPlaceTZ derives tz from coordinates for a Google place that arrived without one.
// The place belongs to the (already decoded) patch, so mutating it is safe.
func fillPlaceTZ(p *models.Place, c Ctx) {
	if p != nil && c.TZ != nil && p.Source == models.SourceGoogle && p.TZ == "" && p.Lat != nil && p.Lng != nil {
		p.TZ = c.TZ(*p.Lat, *p.Lng)
	}
}

func fillTripTZ(p *TripPatch, c Ctx) {
	fillPlaceTZ(p.Destination.Val, c)
	if p.Stops.Val != nil {
		for i := range *p.Stops.Val {
			fillPlaceTZ(&(*p.Stops.Val)[i], c)
		}
	}
}

// todoTitleOK: a todo needs a non-blank title unless it has a Google place, whose display
// name the client shows online (the title is user content only and stays blank by design).
func todoTitleOK(title string, place *models.Place) bool {
	if strings.TrimSpace(title) != "" {
		return true
	}
	return place != nil && place.Source == models.SourceGoogle
}
