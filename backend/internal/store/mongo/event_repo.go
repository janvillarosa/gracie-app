package mongo

import (
	"context"
	"errors"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"go.mongodb.org/mongo-driver/bson"
	mgo "go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// EventRepo stores raw analytics events. Indexes are generic so a new feature's
// events need none of their own.
type EventRepo struct{ db *mgo.Database }

func NewEventRepo(c *Client) *EventRepo   { return &EventRepo{db: c.DB} }
func (r *EventRepo) col() *mgo.Collection { return r.db.Collection("events") }

func (r *EventRepo) EnsureIndexes(ctx context.Context) error {
	_, err := r.col().Indexes().CreateMany(ctx, []mgo.IndexModel{
		{Keys: bson.D{{Key: "event_id", Value: 1}}, Options: options.Index().SetUnique(true)},
		{Keys: bson.D{{Key: "ingested_at", Value: 1}}},
		{Keys: bson.D{{Key: "actor_id", Value: 1}, {Key: "occurred_at", Value: 1}}},
		{Keys: bson.D{{Key: "targets", Value: 1}, {Key: "occurred_at", Value: 1}}},
		{Keys: bson.D{{Key: "room_id", Value: 1}, {Key: "occurred_at", Value: 1}}},
		{Keys: bson.D{{Key: "room_id", Value: 1}, {Key: "container.type", Value: 1}, {Key: "container.id", Value: 1}, {Key: "occurred_at", Value: 1}}},
		{
			Keys: bson.D{{Key: "room_id", Value: 1}, {Key: "subject.type", Value: 1}, {Key: "key", Value: 1}, {Key: "occurred_at", Value: 1}},
			Options: options.Index().SetName("room_subject_key_at").
				SetPartialFilterExpression(bson.D{{Key: "key", Value: bson.D{{Key: "$exists", Value: true}}}}),
		},
		{Keys: bson.D{{Key: "expire_at", Value: 1}}, Options: options.Index().SetName("expire_at_ttl").SetExpireAfterSeconds(0)},
	})
	return err
}

// InsertMany appends events, skipping duplicates by event_id.
func (r *EventRepo) InsertMany(ctx context.Context, evs []analytics.Event) error {
	if len(evs) == 0 {
		return nil
	}
	docs := make([]any, len(evs))
	for i := range evs {
		docs[i] = evs[i]
	}
	_, err := r.col().InsertMany(ctx, docs, options.InsertMany().SetOrdered(false))
	if err != nil && onlyDuplicateKeys(err) {
		return nil
	}
	return err
}

func onlyDuplicateKeys(err error) bool {
	we, ok := err.(mgo.BulkWriteException)
	if !ok || len(we.WriteErrors) == 0 || we.WriteConcernError != nil {
		return false
	}
	for _, e := range we.WriteErrors {
		if e.Code != 11000 {
			return false
		}
	}
	return true
}

func (r *EventRepo) ListIngestedBetween(ctx context.Context, from, to time.Time, limit int) ([]analytics.Event, error) {
	filter := bson.D{{Key: "ingested_at", Value: bson.D{{Key: "$gte", Value: from.UTC()}, {Key: "$lt", Value: to.UTC()}}}}
	cur, err := r.col().Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "ingested_at", Value: 1}, {Key: "event_id", Value: 1}}).SetLimit(int64(limit)))
	if err != nil {
		return nil, err
	}
	var out []analytics.Event
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (r *EventRepo) ListForKey(ctx context.Context, roomID, subjectType, key string, limit int) ([]analytics.Event, error) {
	filter := bson.D{{Key: "room_id", Value: roomID}, {Key: "subject.type", Value: subjectType}, {Key: "key", Value: key}}
	// newest first so the limit keeps the most recent history, then flipped to oldest first
	cur, err := r.col().Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "occurred_at", Value: -1}}).SetLimit(int64(limit)))
	if err != nil {
		return nil, err
	}
	var out []analytics.Event
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}

// since returns up to limit of the newest events matching match at or after since, oldest first.
func (r *EventRepo) since(ctx context.Context, match bson.D, since time.Time, limit int) ([]analytics.Event, error) {
	filter := append(match, bson.E{Key: "occurred_at", Value: bson.D{{Key: "$gte", Value: since.UTC()}}})
	cur, err := r.col().Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "occurred_at", Value: -1}}).SetLimit(int64(limit)))
	if err != nil {
		return nil, err
	}
	var out []analytics.Event
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}

func (r *EventRepo) ListByContainer(ctx context.Context, roomID, containerType, containerID string, names []string, since time.Time, limit int) ([]analytics.Event, error) {
	filter := bson.D{{Key: "room_id", Value: roomID}, {Key: "container.type", Value: containerType}, {Key: "container.id", Value: containerID},
		{Key: "name", Value: bson.D{{Key: "$in", Value: names}}},
		{Key: "occurred_at", Value: bson.D{{Key: "$gte", Value: since.UTC()}}}}
	cur, err := r.col().Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "occurred_at", Value: -1}}).SetLimit(int64(limit)))
	if err != nil {
		return nil, err
	}
	var out []analytics.Event
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (r *EventRepo) ListByActorSince(ctx context.Context, userID string, since time.Time, limit int) ([]analytics.Event, error) {
	return r.since(ctx, bson.D{{Key: "actor_id", Value: userID}}, since, limit)
}

func (r *EventRepo) ListByRoomSince(ctx context.Context, roomID string, since time.Time, limit int) ([]analytics.Event, error) {
	return r.since(ctx, bson.D{{Key: "room_id", Value: roomID}}, since, limit)
}

func (r *EventRepo) DeleteByActor(ctx context.Context, userID string) error {
	_, err := r.col().DeleteMany(ctx, bson.D{{Key: "actor_id", Value: userID}})
	return err
}

func (r *EventRepo) DeleteByRoom(ctx context.Context, roomID string) error {
	_, err := r.col().DeleteMany(ctx, bson.D{{Key: "room_id", Value: roomID}})
	return err
}

// InsertNew is InsertMany that reports how many events were new rather than duplicates.
func (r *EventRepo) InsertNew(ctx context.Context, evs []analytics.Event) (int, error) {
	if len(evs) == 0 {
		return 0, nil
	}
	docs := make([]any, len(evs))
	for i := range evs {
		docs[i] = evs[i]
	}
	_, err := r.col().InsertMany(ctx, docs, options.InsertMany().SetOrdered(false))
	if err == nil {
		return len(evs), nil
	}
	if onlyDuplicateKeys(err) {
		return len(evs) - len(err.(mgo.BulkWriteException).WriteErrors), nil
	}
	return 0, err
}

// EarliestOccurred returns the oldest occurred_at among events from source; ok is false when
// there are none. The backfill uses it as the moment live analytics started.
func (r *EventRepo) EarliestOccurred(ctx context.Context, source string) (time.Time, bool, error) {
	var ev analytics.Event
	err := r.col().FindOne(ctx, bson.D{{Key: "source", Value: source}},
		options.FindOne().SetSort(bson.D{{Key: "occurred_at", Value: 1}}).SetProjection(bson.D{{Key: "occurred_at", Value: 1}})).Decode(&ev)
	if errors.Is(err, mgo.ErrNoDocuments) {
		return time.Time{}, false, nil
	}
	if err != nil {
		return time.Time{}, false, err
	}
	return ev.OccurredAt.UTC(), true, nil
}

var (
	_ analytics.EventRepository = (*EventRepo)(nil)
	_ analytics.BackfillEvents  = (*EventRepo)(nil)
)
