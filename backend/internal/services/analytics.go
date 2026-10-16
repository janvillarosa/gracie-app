package services

import (
	"context"
	"strings"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
)

// emitter gives a service nil-safe event emission. Services embed it and get a
// UseRecorder setter, so constructors and existing tests stay unchanged.
type emitter struct{ rec analytics.Recorder }

// UseRecorder injects the behavior-event recorder (optional).
func (e *emitter) UseRecorder(r analytics.Recorder) { e.rec = r }

// emit records after the domain write succeeded. It never fails or blocks the caller.
func (e *emitter) emit(ctx context.Context, ev analytics.Event) {
	if e.rec == nil {
		return
	}
	if ev.Source == "" {
		ev.Source = analytics.SourceServer
	}
	e.rec.Record(ctx, ev)
}

func fieldsProp(fields []string) map[string]any {
	if len(fields) == 0 {
		return nil
	}
	return map[string]any{"fields": strings.Join(fields, ",")}
}

// emitUser records an account event. The user is its own subject; roomID may be empty
// (email signup has no house yet).
func (e *emitter) emitUser(ctx context.Context, name, userID, roomID string, props map[string]any) {
	e.emit(ctx, analytics.Event{Name: name, ActorID: userID, RoomID: roomID, Subject: analytics.Ref{Type: "user", ID: userID}, Props: props})
}

func ref[T any](v T) *T { return &v }
