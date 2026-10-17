package services

import (
	"context"
	"log"
	"strings"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
)

// emitter gives a service nil-safe event emission. Services embed it and get a
// UseRecorder setter, so constructors and existing tests stay unchanged.
type emitter struct {
	rec    analytics.Recorder
	purger *analytics.Purger
}

// UsePurger injects the eraser used when an account or house is deleted (optional).
func (e *emitter) UsePurger(p *analytics.Purger) { e.purger = p }

// purgeUser and purgeRoom never fail the caller: the account or house is already gone, and
// anything left behind expires with the raw events' TTL.
func (e *emitter) purgeUser(ctx context.Context, userID string) {
	if e.purger == nil {
		return
	}
	if err := e.purger.PurgeUser(ctx, userID); err != nil {
		log.Printf("analytics: purge user %s: %v", userID, err)
	}
}

func (e *emitter) purgeRoom(ctx context.Context, roomID string) {
	if e.purger == nil {
		return
	}
	if err := e.purger.PurgeRoom(ctx, roomID); err != nil {
		log.Printf("analytics: purge house %s: %v", roomID, err)
	}
}

// deleteAutopilotActions removes a gone house's autopilot actions. Like the purges, it never fails
// the caller: the house is already gone.
func deleteAutopilotActions(ctx context.Context, r store.AutopilotActionRepository, roomID string) {
	if r == nil {
		return
	}
	if err := r.DeleteByRoom(ctx, roomID); err != nil {
		log.Printf("autopilot: delete actions of house %s: %v", roomID, err)
	}
}

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

// emitSync records an event the next read must see (the buffered recorder flushes about once a
// second). Recorders without a synchronous path fall back to the ordinary one.
func (e *emitter) emitSync(ctx context.Context, ev analytics.Event) {
	if e.rec == nil {
		return
	}
	if ev.Source == "" {
		ev.Source = analytics.SourceServer
	}
	if sr, ok := e.rec.(analytics.SyncRecorder); ok {
		sr.RecordSync(ctx, ev)
		return
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
