package mongo

import (
	"context"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
	"go.mongodb.org/mongo-driver/bson"
	mgo "go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type PlaceCacheRepo struct{ db *mgo.Database }

func NewPlaceCacheRepo(c *Client) *PlaceCacheRepo { return &PlaceCacheRepo{db: c.DB} }
func (r *PlaceCacheRepo) col() *mgo.Collection    { return r.db.Collection("place_cache") }

const placeCacheTTLSeconds = 30 * 24 * 3600

type placeCacheDoc struct {
	Key       string         `bson:"key"`
	Places    []models.Place `bson:"places"`
	CreatedAt time.Time      `bson:"created_at"`
}

func (r *PlaceCacheRepo) EnsureIndexes(ctx context.Context) error {
	_, err := r.col().Indexes().CreateMany(ctx, []mgo.IndexModel{
		{Keys: bson.D{{Key: "key", Value: 1}}, Options: options.Index().SetUnique(true)},
		{Keys: bson.D{{Key: "created_at", Value: 1}}, Options: options.Index().SetExpireAfterSeconds(placeCacheTTLSeconds)},
	})
	return err
}

func (r *PlaceCacheRepo) Get(ctx context.Context, key string) ([]models.Place, bool, error) {
	var d placeCacheDoc
	err := r.col().FindOne(ctx, bson.D{{Key: "key", Value: key}}).Decode(&d)
	if err == mgo.ErrNoDocuments {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return d.Places, true, nil
}

func (r *PlaceCacheRepo) Put(ctx context.Context, key string, places []models.Place, at time.Time) error {
	_, err := r.col().ReplaceOne(ctx, bson.D{{Key: "key", Value: key}},
		placeCacheDoc{Key: key, Places: places, CreatedAt: at.UTC()}, options.Replace().SetUpsert(true))
	return err
}

var _ store.PlaceCacheRepository = (*PlaceCacheRepo)(nil)
