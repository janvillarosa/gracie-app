package mongo

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	mgo "go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// CategoryIndexEntry is used for bulk seeding.
type CategoryIndexEntry struct {
	Key      string
	Category string
}

// CategoryIndexRepo manages the category_index collection.
type CategoryIndexRepo struct{ db *mgo.Database }

func NewCategoryIndexRepo(c *Client) *CategoryIndexRepo {
	return &CategoryIndexRepo{db: c.DB}
}

func (r *CategoryIndexRepo) col() *mgo.Collection {
	return r.db.Collection("category_index")
}

// EnsureIndexes creates a unique index on the "key" field.
func (r *CategoryIndexRepo) EnsureIndexes(ctx context.Context) error {
	_, err := r.col().Indexes().CreateMany(ctx, []mgo.IndexModel{
		{Keys: bson.D{{Key: "key", Value: 1}}, Options: options.Index().SetUnique(true)},
	})
	return err
}

// Lookup returns (category, true, nil) on hit; ("", false, nil) on not found; ("", false, err) on error.
func (r *CategoryIndexRepo) Lookup(ctx context.Context, key string) (string, bool, error) {
	var doc struct {
		Category string `bson:"category"`
	}
	err := r.col().FindOne(ctx, bson.D{{Key: "key", Value: key}}).Decode(&doc)
	if err != nil {
		if err == mgo.ErrNoDocuments {
			return "", false, nil
		}
		return "", false, err
	}
	return doc.Category, true, nil
}

// Upsert updates or inserts a category for a key, setting updated_at.
func (r *CategoryIndexRepo) Upsert(ctx context.Context, key, category string) error {
	_, err := r.col().UpdateOne(
		ctx,
		bson.D{{Key: "key", Value: key}},
		bson.D{{Key: "$set", Value: bson.D{
			{Key: "category", Value: category},
			{Key: "updated_at", Value: time.Now().UTC()},
		}}},
		options.Update().SetUpsert(true),
	)
	return err
}

// Seed bulk upserts entries. No-op for empty slice.
func (r *CategoryIndexRepo) Seed(ctx context.Context, entries []CategoryIndexEntry) error {
	if len(entries) == 0 {
		return nil
	}

	models := make([]mgo.WriteModel, len(entries))
	now := time.Now().UTC()
	for i, entry := range entries {
		models[i] = mgo.NewUpdateOneModel().
			SetFilter(bson.D{{Key: "key", Value: entry.Key}}).
			SetUpdate(bson.D{{Key: "$set", Value: bson.D{
				{Key: "category", Value: entry.Category},
				{Key: "updated_at", Value: now},
			}}}).
			SetUpsert(true)
	}

	_, err := r.col().BulkWrite(ctx, models, options.BulkWrite().SetOrdered(false))
	return err
}
