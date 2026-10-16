package mongo

import (
	"context"
	"errors"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
	"go.mongodb.org/mongo-driver/bson"
	mgo "go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const stateID = "rollup"

// AggRepo stores the precomputed analytics: period_stats, key_stats, the dirty set and
// the rollup lease/watermark (analytics_state).
type AggRepo struct {
	db *mgo.Database
	tx store.TxRunner
}

func NewAggRepo(c *Client, tx store.TxRunner) *AggRepo { return &AggRepo{db: c.DB, tx: tx} }

func (r *AggRepo) periods() *mgo.Collection { return r.db.Collection("period_stats") }
func (r *AggRepo) keys() *mgo.Collection    { return r.db.Collection("key_stats") }
func (r *AggRepo) dirty() *mgo.Collection   { return r.db.Collection("analytics_dirty") }
func (r *AggRepo) state() *mgo.Collection   { return r.db.Collection("analytics_state") }

func (r *AggRepo) EnsureIndexes(ctx context.Context) error {
	if _, err := r.periods().Indexes().CreateMany(ctx, []mgo.IndexModel{
		{Keys: bson.D{{Key: "scope", Value: 1}, {Key: "owner", Value: 1}, {Key: "period", Value: 1}}},
	}); err != nil {
		return err
	}
	_, err := r.keys().Indexes().CreateMany(ctx, []mgo.IndexModel{
		{Keys: bson.D{{Key: "room_id", Value: 1}, {Key: "subject_type", Value: 1}, {Key: "intervals.due_at", Value: 1}}},
		{Keys: bson.D{{Key: "room_id", Value: 1}, {Key: "subject_type", Value: 1}, {Key: "last_at.added", Value: -1}}},
	})
	return err
}

// AcquireLease takes the lease when it is free, expired, or already ours.
func (r *AggRepo) AcquireLease(ctx context.Context, owner string, ttl time.Duration, now time.Time) (time.Time, bool, error) {
	filter := bson.D{{Key: "_id", Value: stateID}, {Key: "$or", Value: bson.A{
		bson.D{{Key: "lease_until", Value: bson.D{{Key: "$lt", Value: now.UTC()}}}},
		bson.D{{Key: "owner", Value: owner}},
		bson.D{{Key: "lease_until", Value: bson.D{{Key: "$exists", Value: false}}}},
	}}}
	update := bson.D{{Key: "$set", Value: bson.D{{Key: "owner", Value: owner}, {Key: "lease_until", Value: now.Add(ttl).UTC()}}}}
	var doc struct {
		Watermark time.Time `bson:"watermark"`
	}
	err := r.state().FindOneAndUpdate(ctx, filter, update,
		options.FindOneAndUpdate().SetUpsert(true).SetReturnDocument(options.After)).Decode(&doc)
	if err != nil {
		// Someone else holds a live lease: the upsert collides on _id.
		if mgo.IsDuplicateKeyError(err) {
			return time.Time{}, false, nil
		}
		return time.Time{}, false, err
	}
	return doc.Watermark, true, nil
}

func (r *AggRepo) ReleaseLease(ctx context.Context, owner string) error {
	_, err := r.state().UpdateOne(ctx,
		bson.D{{Key: "_id", Value: stateID}, {Key: "owner", Value: owner}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "lease_until", Value: time.Time{}}}}})
	return err
}

func updateDoc(u *analytics.DocUpdate) bson.D {
	out := bson.D{}
	if len(u.Inc) > 0 {
		inc := bson.D{}
		for p, n := range u.Inc {
			inc = append(inc, bson.E{Key: p, Value: n})
		}
		out = append(out, bson.E{Key: "$inc", Value: inc})
	}
	if len(u.Min) > 0 {
		m := bson.D{}
		for p, t := range u.Min {
			m = append(m, bson.E{Key: p, Value: t.UTC()})
		}
		out = append(out, bson.E{Key: "$min", Value: m})
	}
	if len(u.Max) > 0 {
		m := bson.D{}
		for p, t := range u.Max {
			m = append(m, bson.E{Key: p, Value: t.UTC()})
		}
		out = append(out, bson.E{Key: "$max", Value: m})
	}
	if len(u.Set) > 0 {
		s := bson.D{}
		for p, v := range u.Set {
			s = append(s, bson.E{Key: p, Value: v})
		}
		out = append(out, bson.E{Key: "$set", Value: s})
	}
	return out
}

func upserts(updates map[string]*analytics.DocUpdate) []mgo.WriteModel {
	models := make([]mgo.WriteModel, 0, len(updates))
	for id, u := range updates {
		models = append(models, mgo.NewUpdateOneModel().
			SetFilter(bson.D{{Key: "_id", Value: id}}).SetUpdate(updateDoc(u)).SetUpsert(true))
	}
	return models
}

var errLeaseLost = errors.New("analytics: rollup lease lost")

// ApplyBatch writes every aggregate, marks subjects dirty and moves the watermark in one
// transaction, and only while this worker still owns the lease.
func (r *AggRepo) ApplyBatch(ctx context.Context, b *analytics.Batch, owner string, watermark time.Time) error {
	return r.tx.WithTransaction(ctx, func(txctx context.Context) error {
		res, err := r.state().UpdateOne(txctx,
			bson.D{{Key: "_id", Value: stateID}, {Key: "owner", Value: owner}},
			bson.D{{Key: "$set", Value: bson.D{{Key: "watermark", Value: watermark.UTC()}}}})
		if err != nil {
			return err
		}
		if res.MatchedCount == 0 {
			return errLeaseLost
		}
		opts := options.BulkWrite().SetOrdered(false)
		if len(b.Periods) > 0 {
			if _, err := r.periods().BulkWrite(txctx, upserts(b.Periods), opts); err != nil {
				return err
			}
		}
		if len(b.Keys) > 0 {
			if _, err := r.keys().BulkWrite(txctx, upserts(b.Keys), opts); err != nil {
				return err
			}
		}
		if len(b.Dirty) > 0 {
			at := time.Now().UTC()
			dm := make([]mgo.WriteModel, 0, len(b.Dirty))
			for s := range b.Dirty {
				dm = append(dm, mgo.NewUpdateOneModel().
					SetFilter(bson.D{{Key: "_id", Value: s}}).
					SetUpdate(bson.D{{Key: "$set", Value: bson.D{{Key: "at", Value: at}}}}).SetUpsert(true))
			}
			if _, err := r.dirty().BulkWrite(txctx, dm, opts); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *AggRepo) SetKeyIntervals(ctx context.Context, id string, iv analytics.KeyIntervals) error {
	set := bson.D{
		{Key: "intervals.n", Value: iv.N},
		{Key: "intervals.source", Value: iv.Source},
		{Key: "intervals.ewma_days", Value: iv.EWMADays},
		{Key: "intervals.cv", Value: iv.CV},
		{Key: "intervals.last_at", Value: iv.LastAt.UTC()},
		{Key: "intervals.computed_at", Value: iv.ComputedAt.UTC()},
	}
	update := bson.D{{Key: "$set", Value: set}}
	if iv.DueAt != nil {
		set = append(set, bson.E{Key: "intervals.due_at", Value: iv.DueAt.UTC()})
		update = bson.D{{Key: "$set", Value: set}}
	} else {
		update = bson.D{{Key: "$set", Value: set}, {Key: "$unset", Value: bson.D{{Key: "intervals.due_at", Value: ""}}}}
	}
	// No upsert: the document was created by ApplyBatch; a key deleted since is simply gone.
	_, err := r.keys().UpdateOne(ctx, bson.D{{Key: "_id", Value: id}}, update)
	return err
}

func (r *AggRepo) DeleteByRoom(ctx context.Context, roomID string) error {
	if _, err := r.periods().DeleteMany(ctx, bson.D{{Key: "scope", Value: "h"}, {Key: "owner", Value: roomID}}); err != nil {
		return err
	}
	if _, err := r.keys().DeleteMany(ctx, bson.D{{Key: "room_id", Value: roomID}}); err != nil {
		return err
	}
	_, err := r.dirty().DeleteOne(ctx, bson.D{{Key: "_id", Value: "h:" + roomID}})
	return err
}

func (r *AggRepo) DeleteByUser(ctx context.Context, userID string) error {
	if _, err := r.periods().DeleteMany(ctx, bson.D{{Key: "scope", Value: "u"}, {Key: "owner", Value: userID}}); err != nil {
		return err
	}
	_, err := r.dirty().DeleteOne(ctx, bson.D{{Key: "_id", Value: "u:" + userID}})
	return err
}

var _ analytics.AggregateRepository = (*AggRepo)(nil)
