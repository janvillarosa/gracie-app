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

type ListRepo struct{ db *mgo.Database }

func NewListRepo(c *Client) *ListRepo { return &ListRepo{db: c.DB} }
func (r *ListRepo) col() *mgo.Collection { return r.db.Collection("lists") }

func (r *ListRepo) EnsureIndexes(ctx context.Context) error {
    _, err := r.col().Indexes().CreateMany(ctx, []mgo.IndexModel{
        {Keys: bson.D{{Key: "list_id", Value: 1}}, Options: options.Index().SetUnique(true)},
        {Keys: bson.D{{Key: "room_id", Value: 1}}},
    })
    return err
}

func (r *ListRepo) Put(ctx context.Context, l *models.List) error {
    _, err := r.col().InsertOne(ctx, l)
    return err
}

func (r *ListRepo) GetByID(ctx context.Context, id string) (*models.List, error) {
    var l models.List
    err := r.col().FindOne(ctx, bson.D{{Key: "list_id", Value: id}}).Decode(&l)
    if err != nil {
        if err == mgo.ErrNoDocuments { return nil, derr.ErrNotFound }
        return nil, err
    }
    return &l, nil
}

func (r *ListRepo) ListByRoom(ctx context.Context, roomID string) ([]models.List, error) {
    cur, err := r.col().Find(ctx, bson.D{{Key: "room_id", Value: roomID}})
    if err != nil { return nil, err }
    var out []models.List
    if err := cur.All(ctx, &out); err != nil { return nil, err }
    return out, nil
}

func (r *ListRepo) AddDeletionVote(ctx context.Context, listID string, userID string, ts time.Time) error {
    _, err := r.col().UpdateOne(ctx, bson.D{{Key: "list_id", Value: listID}}, bson.D{{Key: "$set", Value: bson.D{{Key: "deletion_votes." + userID, Value: ts.UTC().Format(time.RFC3339)}, {Key: "updated_at", Value: ts.UTC()}}}})
    return err
}

func (r *ListRepo) RemoveDeletionVote(ctx context.Context, listID string, userID string) error {
    _, err := r.col().UpdateOne(ctx, bson.D{{Key: "list_id", Value: listID}}, bson.D{{Key: "$unset", Value: bson.D{{Key: "deletion_votes." + userID, Value: ""}}}})
    return err
}

func (r *ListRepo) FinalizeDeleteIfBothVoted(ctx context.Context, listID, uid1, uid2 string, ts time.Time) (bool, error) {
    // Set is_deleted when both votes exist and not already deleted
    res, err := r.col().UpdateOne(ctx,
        bson.D{{Key: "list_id", Value: listID}, {Key: "deletion_votes." + uid1, Value: bson.D{{Key: "$exists", Value: true}}}, {Key: "deletion_votes." + uid2, Value: bson.D{{Key: "$exists", Value: true}}}, {Key: "is_deleted", Value: bson.D{{Key: "$ne", Value: true}}}},
        bson.D{{Key: "$set", Value: bson.D{{Key: "is_deleted", Value: true}, {Key: "updated_at", Value: ts.UTC()}}}},
    )
    if err != nil { return false, err }
    return res.ModifiedCount > 0, nil
}

func (r *ListRepo) Delete(ctx context.Context, listID string) error {
    _, err := r.col().DeleteOne(ctx, bson.D{{Key: "list_id", Value: listID}})
    return err
}
