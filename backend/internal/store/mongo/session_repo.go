package mongo

import (
	"context"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	mgo "go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// SessionRepo stores sessions: one per signed-in device.
type SessionRepo struct{ db *mgo.Database }

func NewSessionRepo(c *Client) *SessionRepo { return &SessionRepo{db: c.DB} }

func (r *SessionRepo) col() *mgo.Collection { return r.db.Collection("sessions") }

func (r *SessionRepo) EnsureIndexes(ctx context.Context) error {
	_, err := r.col().Indexes().CreateMany(ctx, []mgo.IndexModel{
		{Keys: bson.D{{Key: "session_id", Value: 1}}, Options: options.Index().SetUnique(true)},
		{Keys: bson.D{{Key: "key_lookup", Value: 1}}, Options: options.Index().SetUnique(true)},
		{Keys: bson.D{{Key: "user_id", Value: 1}, {Key: "created_at", Value: -1}}},
		{Keys: bson.D{{Key: "expires_at", Value: 1}}, Options: options.Index().SetExpireAfterSeconds(0).SetName("expires_at_ttl")},
	})
	return err
}

func (r *SessionRepo) Insert(ctx context.Context, s *models.Session) error {
	if _, err := r.col().InsertOne(ctx, s); err != nil {
		if mgo.IsDuplicateKeyError(err) {
			return derr.ErrConflict
		}
		return err
	}
	return nil
}

func (r *SessionRepo) GetByLookup(ctx context.Context, lookup string) (*models.Session, error) {
	var s models.Session
	if err := r.col().FindOne(ctx, bson.D{{Key: "key_lookup", Value: lookup}}).Decode(&s); err != nil {
		if err == mgo.ErrNoDocuments {
			return nil, derr.ErrNotFound
		}
		return nil, err
	}
	return &s, nil
}

func (r *SessionRepo) Delete(ctx context.Context, sessionID string) error {
	_, err := r.col().DeleteOne(ctx, bson.D{{Key: "session_id", Value: sessionID}})
	return err
}

func (r *SessionRepo) ids(ctx context.Context, filter bson.D, opts *options.FindOptions) ([]string, error) {
	cur, err := r.col().Find(ctx, filter, opts.SetProjection(bson.D{{Key: "session_id", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var rows []struct {
		SessionID string `bson:"session_id"`
	}
	if err := cur.All(ctx, &rows); err != nil {
		return nil, err
	}
	out := make([]string, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.SessionID)
	}
	return out, nil
}

func (r *SessionRepo) deleteIDs(ctx context.Context, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := r.col().DeleteMany(ctx, bson.D{{Key: "session_id", Value: bson.D{{Key: "$in", Value: ids}}}})
	return err
}

func (r *SessionRepo) DeleteByUser(ctx context.Context, userID, keepID string) ([]string, error) {
	filter := bson.D{{Key: "user_id", Value: userID}}
	if keepID != "" {
		filter = append(filter, bson.E{Key: "session_id", Value: bson.D{{Key: "$ne", Value: keepID}}})
	}
	ids, err := r.ids(ctx, filter, options.Find())
	if err != nil {
		return nil, err
	}
	return ids, r.deleteIDs(ctx, ids)
}

func (r *SessionRepo) TrimByUser(ctx context.Context, userID string, keep int) ([]string, error) {
	ids, err := r.ids(ctx, bson.D{{Key: "user_id", Value: userID}}, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}).SetSkip(int64(keep)))
	if err != nil {
		return nil, err
	}
	return ids, r.deleteIDs(ctx, ids)
}

func (r *SessionRepo) LiveIDs(ctx context.Context, ids []string, now time.Time) (map[string]bool, error) {
	out := map[string]bool{}
	if len(ids) == 0 {
		return out, nil
	}
	live, err := r.ids(ctx, bson.D{{Key: "session_id", Value: bson.D{{Key: "$in", Value: ids}}},
		{Key: "expires_at", Value: bson.D{{Key: "$gt", Value: now.UTC()}}}}, options.Find())
	if err != nil {
		return nil, err
	}
	for _, id := range live {
		out[id] = true
	}
	return out, nil
}
