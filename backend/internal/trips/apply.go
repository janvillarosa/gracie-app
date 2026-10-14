package trips

import (
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
