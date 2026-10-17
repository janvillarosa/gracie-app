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

const autopilotLeaseID = "tick"

// AutopilotRepo stores autopilot_actions and the ticker lease (autopilot_state).
type AutopilotRepo struct{ db *mgo.Database }

func NewAutopilotRepo(c *Client) *AutopilotRepo { return &AutopilotRepo{db: c.DB} }

func (r *AutopilotRepo) actions() *mgo.Collection { return r.db.Collection("autopilot_actions") }
func (r *AutopilotRepo) state() *mgo.Collection   { return r.db.Collection("autopilot_state") }

func (r *AutopilotRepo) EnsureIndexes(ctx context.Context) error {
	_, err := r.actions().Indexes().CreateMany(ctx, []mgo.IndexModel{
		{Keys: bson.D{{Key: "action_id", Value: 1}}, Options: options.Index().SetUnique(true)},
		// One action per thing per forecast cycle, however many instances tick at once.
		{Keys: bson.D{{Key: "room_id", Value: 1}, {Key: "kind", Value: 1}, {Key: "key", Value: 1}, {Key: "cycle", Value: 1}}, Options: options.Index().SetUnique(true)},
		{Keys: bson.D{{Key: "item_id", Value: 1}}, Options: options.Index().SetSparse(true)},
		{Keys: bson.D{{Key: "list_id", Value: 1}, {Key: "created_at", Value: -1}}},
		{Keys: bson.D{{Key: "room_id", Value: 1}, {Key: "state", Value: 1}}},
		{Keys: bson.D{{Key: "purge_at", Value: 1}}, Options: options.Index().SetExpireAfterSeconds(0).SetName("purge_at_ttl")},
	})
	return err
}

func (r *AutopilotRepo) Insert(ctx context.Context, a *models.AutopilotAction) error {
	if _, err := r.actions().InsertOne(ctx, a); err != nil {
		if mgo.IsDuplicateKeyError(err) {
			return derr.ErrConflict
		}
		return err
	}
	return nil
}

func (r *AutopilotRepo) SetItem(ctx context.Context, actionID, itemID string) error {
	_, err := r.actions().UpdateOne(ctx, bson.D{{Key: "action_id", Value: actionID}}, bson.D{{Key: "$set", Value: bson.D{{Key: "item_id", Value: itemID}}}})
	return err
}

func (r *AutopilotRepo) Delete(ctx context.Context, actionID string) error {
	_, err := r.actions().DeleteOne(ctx, bson.D{{Key: "action_id", Value: actionID}})
	return err
}

func (r *AutopilotRepo) findOne(ctx context.Context, filter bson.D) (*models.AutopilotAction, error) {
	var a models.AutopilotAction
	if err := r.actions().FindOne(ctx, filter).Decode(&a); err != nil {
		if err == mgo.ErrNoDocuments {
			return nil, derr.ErrNotFound
		}
		return nil, err
	}
	return &a, nil
}

func (r *AutopilotRepo) GetByID(ctx context.Context, actionID string) (*models.AutopilotAction, error) {
	return r.findOne(ctx, bson.D{{Key: "action_id", Value: actionID}})
}

func (r *AutopilotRepo) GetByItem(ctx context.Context, itemID string) (*models.AutopilotAction, error) {
	return r.findOne(ctx, bson.D{{Key: "item_id", Value: itemID}})
}

func (r *AutopilotRepo) list(ctx context.Context, filter bson.D) ([]models.AutopilotAction, error) {
	cur, err := r.actions().Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}))
	if err != nil {
		return nil, err
	}
	var out []models.AutopilotAction
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (r *AutopilotRepo) ListByList(ctx context.Context, listID string, since time.Time) ([]models.AutopilotAction, error) {
	return r.list(ctx, bson.D{{Key: "list_id", Value: listID}, {Key: "created_at", Value: bson.D{{Key: "$gte", Value: since.UTC()}}}})
}

func (r *AutopilotRepo) ListApplied(ctx context.Context, roomID string) ([]models.AutopilotAction, error) {
	return r.list(ctx, bson.D{{Key: "room_id", Value: roomID}, {Key: "state", Value: models.ActionApplied}})
}

// Resolve is a conditional update on the expected state, so two outcomes racing (an undo and a
// delete) resolve the action once.
func (r *AutopilotRepo) Resolve(ctx context.Context, actionID string, from []string, to string, at time.Time) (bool, error) {
	purge := at.Add(store.AutopilotRetention).UTC()
	res, err := r.actions().UpdateOne(ctx,
		bson.D{{Key: "action_id", Value: actionID}, {Key: "state", Value: bson.D{{Key: "$in", Value: from}}}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "state", Value: to}, {Key: "resolved_at", Value: at.UTC()}, {Key: "purge_at", Value: purge}}}})
	if err != nil {
		return false, err
	}
	return res.ModifiedCount == 1, nil
}

func (r *AutopilotRepo) DeleteByRoom(ctx context.Context, roomID string) error {
	_, err := r.actions().DeleteMany(ctx, bson.D{{Key: "room_id", Value: roomID}})
	return err
}

// AcquireLease takes the lease when it is free, expired, or already ours (like the rollup's).
func (r *AutopilotRepo) AcquireLease(ctx context.Context, owner string, ttl time.Duration, now time.Time) (bool, error) {
	filter := bson.D{{Key: "_id", Value: autopilotLeaseID}, {Key: "$or", Value: bson.A{
		bson.D{{Key: "lease_until", Value: bson.D{{Key: "$lt", Value: now.UTC()}}}},
		bson.D{{Key: "owner", Value: owner}},
		bson.D{{Key: "lease_until", Value: bson.D{{Key: "$exists", Value: false}}}},
	}}}
	update := bson.D{{Key: "$set", Value: bson.D{{Key: "owner", Value: owner}, {Key: "lease_until", Value: now.Add(ttl).UTC()}}}}
	err := r.state().FindOneAndUpdate(ctx, filter, update, options.FindOneAndUpdate().SetUpsert(true)).Err()
	if err == nil || err == mgo.ErrNoDocuments {
		return true, nil
	}
	if mgo.IsDuplicateKeyError(err) {
		return false, nil // someone else holds a live lease: the upsert collides on _id
	}
	return false, err
}
