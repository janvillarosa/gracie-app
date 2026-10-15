package mongo

import (
	"context"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
	"go.mongodb.org/mongo-driver/bson"
	mgo "go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type TripRepo struct{ db *mgo.Database }

func NewTripRepo(c *Client) *TripRepo    { return &TripRepo{db: c.DB} }
func (r *TripRepo) col() *mgo.Collection { return r.db.Collection("trips") }

func (r *TripRepo) EnsureIndexes(ctx context.Context) error {
	_, err := r.col().Indexes().CreateMany(ctx, []mgo.IndexModel{
		{Keys: bson.D{{Key: "trip_id", Value: 1}}, Options: options.Index().SetUnique(true)},
		// Serves the sync manifest straight from the index.
		{Keys: bson.D{{Key: "room_id", Value: 1}, {Key: "deleted_at", Value: 1}, {Key: "trip_id", Value: 1}, {Key: "version", Value: 1}, {Key: "deleted_by", Value: 1}}},
		// purge_at is only set on soft delete; Mongo removes the trip 30 days later.
		{Keys: bson.D{{Key: "purge_at", Value: 1}}, Options: options.Index().SetName("purge_at_ttl").SetExpireAfterSeconds(0)},
	})
	return err
}

func (r *TripRepo) Get(ctx context.Context, tripID string) (*models.Trip, error) {
	var t models.Trip
	err := r.col().FindOne(ctx, bson.D{{Key: "trip_id", Value: tripID}}).Decode(&t)
	if err != nil {
		if err == mgo.ErrNoDocuments {
			return nil, derr.ErrNotFound
		}
		return nil, err
	}
	return &t, nil
}

func (r *TripRepo) Insert(ctx context.Context, t *models.Trip) error {
	if _, err := r.col().InsertOne(ctx, t); err != nil {
		if mgo.IsDuplicateKeyError(err) {
			return derr.ErrConflict
		}
		return err
	}
	return nil
}

func (r *TripRepo) ReplaceCAS(ctx context.Context, t *models.Trip, expect int64) (bool, error) {
	res, err := r.col().ReplaceOne(ctx, bson.D{{Key: "trip_id", Value: t.TripID}, {Key: "version", Value: expect}}, t)
	if err != nil {
		return false, err
	}
	return res.MatchedCount == 1, nil
}

func (r *TripRepo) Manifest(ctx context.Context, roomID string) ([]store.TripStub, error) {
	cur, err := r.col().Find(ctx, bson.D{{Key: "room_id", Value: roomID}},
		options.Find().SetProjection(bson.D{{Key: "trip_id", Value: 1}, {Key: "version", Value: 1}, {Key: "deleted_at", Value: 1}, {Key: "deleted_by", Value: 1}, {Key: "_id", Value: 0}}))
	if err != nil {
		return nil, err
	}
	var out []store.TripStub
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (r *TripRepo) GetMany(ctx context.Context, roomID string, ids []string) ([]models.Trip, error) {
	cur, err := r.col().Find(ctx, bson.D{{Key: "room_id", Value: roomID}, {Key: "trip_id", Value: bson.D{{Key: "$in", Value: ids}}}})
	if err != nil {
		return nil, err
	}
	var out []models.Trip
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// LinkPackingList uses an update pipeline so version and v can be incremented from the
// stored value in the same atomic write.
func (r *TripRepo) LinkPackingList(ctx context.Context, tripID, roomID string, expect *string, listID string, at time.Time) (bool, error) {
	var cur any // nil matches a missing or null packing_list_id
	if expect != nil {
		cur = *expect
	}
	filter := bson.D{{Key: "trip_id", Value: tripID}, {Key: "room_id", Value: roomID}, {Key: "deleted_at", Value: nil}, {Key: "packing_list_id", Value: cur}}
	update := mgo.Pipeline{{{Key: "$set", Value: bson.D{
		{Key: "packing_list_id", Value: listID},
		{Key: "version", Value: bson.D{{Key: "$add", Value: bson.A{"$version", 1}}}},
		{Key: "v", Value: bson.D{{Key: "$add", Value: bson.A{"$version", 1}}}},
		{Key: "updated_at", Value: at.UTC()},
	}}}}
	res, err := r.col().UpdateOne(ctx, filter, update)
	if err != nil {
		return false, err
	}
	return res.ModifiedCount == 1, nil
}

func (r *TripRepo) MoveRoom(ctx context.Context, from, to string, at time.Time) error {
	update := mgo.Pipeline{{{Key: "$set", Value: bson.D{
		{Key: "room_id", Value: to},
		{Key: "version", Value: bson.D{{Key: "$add", Value: bson.A{"$version", 1}}}},
		{Key: "v", Value: bson.D{{Key: "$add", Value: bson.A{"$version", 1}}}},
		{Key: "updated_at", Value: at.UTC()},
	}}}}
	_, err := r.col().UpdateMany(ctx, bson.D{{Key: "room_id", Value: from}}, update)
	return err
}

func (r *TripRepo) DeleteByRoom(ctx context.Context, roomID string) error {
	_, err := r.col().DeleteMany(ctx, bson.D{{Key: "room_id", Value: roomID}})
	return err
}

var _ store.TripRepository = (*TripRepo)(nil)
