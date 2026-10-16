package mongo

import (
	"context"
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

func (r *EventRepo) DeleteByActor(ctx context.Context, userID string) error {
	_, err := r.col().DeleteMany(ctx, bson.D{{Key: "actor_id", Value: userID}})
	return err
}

func (r *EventRepo) DeleteByRoom(ctx context.Context, roomID string) error {
	_, err := r.col().DeleteMany(ctx, bson.D{{Key: "room_id", Value: roomID}})
	return err
}

var _ analytics.EventRepository = (*EventRepo)(nil)
