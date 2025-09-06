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

type ListItemRepo struct{ db *mgo.Database }

func NewListItemRepo(c *Client) *ListItemRepo { return &ListItemRepo{db: c.DB} }
func (r *ListItemRepo) col() *mgo.Collection { return r.db.Collection("list_items") }

func (r *ListItemRepo) EnsureIndexes(ctx context.Context) error {
    _, err := r.col().Indexes().CreateMany(ctx, []mgo.IndexModel{
        {Keys: bson.D{{Key: "item_id", Value: 1}}, Options: options.Index().SetUnique(true)},
        {Keys: bson.D{{Key: "list_id", Value: 1}}},
        {Keys: bson.D{{Key: "list_id", Value: 1}, {Key: "order", Value: 1}}},
    })
    return err
}

func (r *ListItemRepo) Put(ctx context.Context, it *models.ListItem) error {
    _, err := r.col().InsertOne(ctx, it)
    return err
}

func (r *ListItemRepo) GetByID(ctx context.Context, id string) (*models.ListItem, error) {
    var it models.ListItem
    err := r.col().FindOne(ctx, bson.D{{Key: "item_id", Value: id}}).Decode(&it)
    if err != nil {
        if err == mgo.ErrNoDocuments { return nil, derr.ErrNotFound }
        return nil, err
    }
    return &it, nil
}

func (r *ListItemRepo) ListByList(ctx context.Context, listID string) ([]models.ListItem, error) {
    // Sort by order (ascending), then created_at as a stable fallback.
    cur, err := r.col().Find(ctx, bson.D{{Key: "list_id", Value: listID}}, options.Find().SetSort(bson.D{{Key: "order", Value: 1}, {Key: "created_at", Value: 1}}))
    if err != nil { return nil, err }
    var out []models.ListItem
    if err := cur.All(ctx, &out); err != nil { return nil, err }
    return out, nil
}

func (r *ListItemRepo) UpdateCompletion(ctx context.Context, itemID string, completed bool, updatedAt time.Time) error {
    _, err := r.col().UpdateOne(ctx, bson.D{{Key: "item_id", Value: itemID}}, bson.D{{Key: "$set", Value: bson.D{{Key: "completed", Value: completed}, {Key: "updated_at", Value: updatedAt.UTC()}}}})
    return err
}

func (r *ListItemRepo) UpdateDescription(ctx context.Context, itemID string, description string, updatedAt time.Time) error {
    _, err := r.col().UpdateOne(ctx, bson.D{{Key: "item_id", Value: itemID}}, bson.D{{Key: "$set", Value: bson.D{{Key: "description", Value: description}, {Key: "updated_at", Value: updatedAt.UTC()}}}})
    return err
}

func (r *ListItemRepo) UpdateOrder(ctx context.Context, itemID string, order float64, updatedAt time.Time) error {
    _, err := r.col().UpdateOne(ctx, bson.D{{Key: "item_id", Value: itemID}}, bson.D{{Key: "$set", Value: bson.D{{Key: "order", Value: order}, {Key: "updated_at", Value: updatedAt.UTC()}}}})
    return err
}

func (r *ListItemRepo) Delete(ctx context.Context, itemID string) error {
    _, err := r.col().DeleteOne(ctx, bson.D{{Key: "item_id", Value: itemID}})
    return err
}
