// Package analytics records user and house behavior as domain-agnostic events and
// serves precomputed aggregates for suggestions, nudges and year-in-review.
// Nothing in this package names a concrete feature: domains register their own events.
package analytics

import "time"

const (
	SourceServer = "server"
	SourceClient = "client"
	// SourceBackfill marks events rebuilt from domain documents that predate analytics.
	SourceBackfill = "backfill"

	// EnvelopeVersion is bumped only on a breaking envelope change.
	EnvelopeVersion = 1
)

// Ref points at an entity of any type ("list", "item", "trip", later "recipe", ...).
type Ref struct {
	Type string `bson:"type" json:"type"`
	ID   string `bson:"id" json:"id"`
}

// LocalTime is the event's wall-clock time, computed once at write time so rollups
// never redo timezone math and an event keeps the local time it happened in.
type LocalTime struct {
	TZ   string `bson:"tz"`
	Date string `bson:"date"` // 2026-10-16
	DOW  int    `bson:"dow"`  // 0=Sunday
	Hour int    `bson:"hour"` // 0-23
	HOW  int    `bson:"how"`  // hour-of-week 0-167 (dow*24+hour)
}

// Event is the single envelope for every tracked behavior.
type Event struct {
	EventID    string         `bson:"event_id"`
	V          int            `bson:"v"`
	Name       string         `bson:"name"` // "<subject type>.<verb>"
	Source     string         `bson:"source"`
	ActorID    string         `bson:"actor_id"`
	RoomID     string         `bson:"room_id"`
	Subject    Ref            `bson:"subject"`
	Container  *Ref           `bson:"container,omitempty"`
	Key        string         `bson:"key,omitempty"` // stable identity across instances; never raw user text
	Category   string         `bson:"category,omitempty"`
	Targets    []string       `bson:"targets,omitempty"`
	Props      map[string]any `bson:"props,omitempty"`
	OccurredAt time.Time      `bson:"occurred_at"`
	Local      LocalTime      `bson:"local"`
	IngestedAt time.Time      `bson:"ingested_at"`
	ClientID   string         `bson:"client_id,omitempty"`
	SessionID  string         `bson:"session_id,omitempty"`
	ExpireAt   time.Time      `bson:"expire_at"`
}

// LocalAt buckets t into the given IANA zone, falling back to UTC for an unknown zone.
func LocalAt(t time.Time, tz string) LocalTime {
	loc := time.UTC
	if tz != "" {
		if l, err := time.LoadLocation(tz); err == nil {
			loc = l
		}
	}
	lt := t.In(loc)
	dow := int(lt.Weekday())
	return LocalTime{TZ: loc.String(), Date: lt.Format("2006-01-02"), DOW: dow, Hour: lt.Hour(), HOW: dow*24 + lt.Hour()}
}
