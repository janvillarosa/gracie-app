package trips

import (
	"sort"
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
}

// Outcome tells the caller what to persist.
type Outcome struct {
	Dirty bool // the trip changed in some way (at least acked) and must be written
	Bump  bool // data changed; t.Version has been set to Ctx.NewV
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
	at := op.At
	if ms := c.Now.UnixMilli(); at > ms {
		at = ms // a skewed phone clock must not win forever
	}
	bump := dispatch(t, op, at, c, &res)
	if t.Acked == nil {
		t.Acked = map[string]int64{}
	}
	t.Acked[op.ClientID] = op.Seq // every non-duplicate outcome consumes the seq
	if bump {
		t.Version = c.NewV
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
	return ch
}

func tripCreate(t *models.Trip, op models.Op, at int64, c Ctx, res *models.OpResult) bool {
	if t.Version != 0 {
		return fail(res, models.CodeForbiddenOrUnknown)
	}
	var p TripPatch
	if code := decodePatch(op.Patch, &p); code != "" {
		return fail(res, code)
	}
	if !validTripPatch(p, true) || !datesOrdered(pick(p.StartDate, nil), pick(p.EndDate, nil)) {
		return fail(res, models.CodeInvalid)
	}
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
	if !validTripPatch(p, false) || !datesOrdered(pick(p.StartDate, t.StartDate), pick(p.EndDate, t.EndDate)) {
		return fail(res, models.CodeInvalid)
	}
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
	return ch
}

func todoCreate(t *models.Trip, op models.Op, at int64, c Ctx, res *models.OpResult) bool {
	if len(t.Todos) >= MaxTodos {
		return fail(res, models.CodeCap)
	}
	if tombstoned(t, op.EntityID) {
		return fail(res, models.CodeGone)
	}
	if findTodo(t, op.EntityID) >= 0 {
		return fail(res, models.CodeInvalid)
	}
	var p TodoPatch
	if code := decodePatch(op.Patch, &p); code != "" {
		return fail(res, code)
	}
	if !validTodoPatch(p, true) {
		return fail(res, models.CodeInvalid)
	}
	td := models.TripTodo{TodoID: op.EntityID, Category: "other", FieldAt: map[string]int64{}}
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
	if !validTodoPatch(p, false) {
		return fail(res, models.CodeInvalid)
	}
	td := &t.Todos[i]
	if !commit(&td.FieldAt, at, todoChanges(td, p, c.Actor, c.Now), res) {
		return false
	}
	td.V = c.NewV
	resolveTodoTZ(t, td)
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
	if p.Notes != nil {
		v := *p.Notes
		ch = append(ch, change{"notes", func() { b.Notes = v }})
	}
	return ch
}

func bookingCreate(t *models.Trip, op models.Op, at int64, c Ctx, res *models.OpResult) bool {
	if len(t.Bookings) >= MaxBookings {
		return fail(res, models.CodeCap)
	}
	if tombstoned(t, op.EntityID) {
		return fail(res, models.CodeGone)
	}
	if findBooking(t, op.EntityID) >= 0 {
		return fail(res, models.CodeInvalid)
	}
	var p BookingPatch
	if code := decodePatch(op.Patch, &p); code != "" {
		return fail(res, code)
	}
	if !validBookingPatch(p, true) {
		return fail(res, models.CodeInvalid)
	}
	b := models.Booking{BookingID: op.EntityID, FieldAt: map[string]int64{}}
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
	if !validBookingPatch(p, false) {
		return fail(res, models.CodeInvalid)
	}
	b := &t.Bookings[i]
	if !commit(&b.FieldAt, at, bookingChanges(b, p), res) {
		return false
	}
	b.V = c.NewV
	return true
}

func bookingDelete(t *models.Trip, op models.Op, c Ctx, res *models.OpResult) bool {
	i := findBooking(t, op.EntityID)
	if i < 0 {
		return false
	}
	t.Bookings = append(t.Bookings[:i], t.Bookings[i+1:]...)
	t.Tombstones = append(t.Tombstones, models.Tombstone{ID: op.EntityID, V: c.NewV, At: c.Now})
	return true
}
