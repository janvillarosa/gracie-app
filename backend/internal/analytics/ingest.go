package analytics

import (
	"errors"
	"regexp"
	"time"
)

const (
	// MaxClientBatch bounds one POST /events call.
	MaxClientBatch = 50
	maxBackdate    = 7 * 24 * time.Hour
	maxFuture      = 5 * time.Minute
	maxKeyLen      = 100
)

var (
	reToken = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	reEvent = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)

	ErrNotClientEvent = errors.New("analytics: event is not accepted from clients")
	ErrInvalidEvent   = errors.New("analytics: invalid event")
)

// ClientEvent is the wire shape a client may send. It carries no identity: the actor
// and house always come from authentication, never from the body.
type ClientEvent struct {
	EventID    string         `json:"event_id"`    // client-generated; makes retries idempotent
	Name       string         `json:"name"`        // must be registered with Client: true
	OccurredAt int64          `json:"occurred_at"` // ms since epoch; 0 means now
	Subject    Ref            `json:"subject"`     // Subject.Type must equal the name's prefix
	Container  *Ref           `json:"container,omitempty"`
	Key        string         `json:"key,omitempty"`
	Props      map[string]any `json:"props,omitempty"`
	ClientID   string         `json:"client_id,omitempty"`
	SessionID  string         `json:"session_id,omitempty"`
}

func validRef(r Ref) bool { return reToken.MatchString(r.Type) && reToken.MatchString(r.ID) }

// BuildClient validates a client event against the registry and returns the envelope
// to record. Unknown props are dropped; the time is clamped to [now-7d, now+5m].
func (r *Registry) BuildClient(ce ClientEvent, actorID, roomID string, now time.Time) (Event, error) {
	def, ok := r.Resolve(ce.Name)
	if !ok || !def.Client {
		return Event{}, ErrNotClientEvent
	}
	if !reEvent.MatchString(ce.EventID) || !validRef(ce.Subject) || ce.Subject.Type != SubjectType(def.Name) {
		return Event{}, ErrInvalidEvent
	}
	if ce.Container != nil && !validRef(*ce.Container) {
		return Event{}, ErrInvalidEvent
	}
	if len(ce.Key) > maxKeyLen || (ce.ClientID != "" && !reToken.MatchString(ce.ClientID)) || (ce.SessionID != "" && !reToken.MatchString(ce.SessionID)) {
		return Event{}, ErrInvalidEvent
	}
	at := now
	if ce.OccurredAt > 0 {
		at = time.UnixMilli(ce.OccurredAt).UTC()
	}
	if at.After(now.Add(maxFuture)) {
		at = now
	}
	if at.Before(now.Add(-maxBackdate)) {
		at = now.Add(-maxBackdate)
	}
	return Event{
		EventID: ce.EventID, Name: def.Name, Source: SourceClient,
		ActorID: actorID, RoomID: roomID,
		Subject: ce.Subject, Container: ce.Container, Key: ce.Key,
		Props: def.Sanitize(ce.Props), OccurredAt: at,
		ClientID: ce.ClientID, SessionID: ce.SessionID,
	}, nil
}
