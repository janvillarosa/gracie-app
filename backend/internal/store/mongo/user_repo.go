package mongo

import (
    "context"
    "errors"
    "time"

    derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
    "github.com/janvillarosa/gracie-app/backend/internal/models"
    "go.mongodb.org/mongo-driver/bson"
    mgo "go.mongodb.org/mongo-driver/mongo"
    "go.mongodb.org/mongo-driver/mongo/options"
)

type UserRepo struct {
    db *mgo.Database
}

func NewUserRepo(c *Client) *UserRepo { return &UserRepo{db: c.DB} }

func (r *UserRepo) col() *mgo.Collection { return r.db.Collection("users") }

func (r *UserRepo) EnsureIndexes(ctx context.Context) error {
    // unique on username, api_key_lookup
    _, err := r.col().Indexes().CreateMany(ctx, []mgo.IndexModel{
        {Keys: bson.D{{Key: "username", Value: 1}}, Options: options.Index().SetUnique(true)},
        {Keys: bson.D{{Key: "api_key_lookup", Value: 1}}, Options: options.Index().SetUnique(true)},
        {Keys: bson.D{{Key: "user_id", Value: 1}}, Options: options.Index().SetUnique(true)},
    })
    return err
}

func (r *UserRepo) Put(ctx context.Context, u *models.User) error {
    _, err := r.col().InsertOne(ctx, u)
    if err != nil {
        var we *mgo.WriteException
        if errors.As(err, &we) {
            return we
        }
    }
    return err
}

func (r *UserRepo) GetByID(ctx context.Context, id string) (*models.User, error) {
    var u models.User
    err := r.col().FindOne(ctx, bson.D{{Key: "user_id", Value: id}}).Decode(&u)
    if err != nil {
        if err == mgo.ErrNoDocuments { return nil, derr.ErrNotFound }
        return nil, err
    }
    return &u, nil
}

func (r *UserRepo) GetByUsername(ctx context.Context, username string) (*models.User, error) {
    var u models.User
    err := r.col().FindOne(ctx, bson.D{{Key: "username", Value: username}}).Decode(&u)
    if err != nil {
        if err == mgo.ErrNoDocuments { return nil, derr.ErrNotFound }
        return nil, err
    }
    return &u, nil
}

func (r *UserRepo) GetByAPIKeyLookup(ctx context.Context, lookup string) (*models.User, error) {
    var u models.User
    err := r.col().FindOne(ctx, bson.D{{Key: "api_key_lookup", Value: lookup}}).Decode(&u)
    if err != nil {
        if err == mgo.ErrNoDocuments { return nil, derr.ErrUnauthorized }
        return nil, err
    }
    return &u, nil
}

func (r *UserRepo) SetAPIKey(ctx context.Context, userID string, hash, lookup string, expiresAt *time.Time, updatedAt time.Time) error {
    update := bson.D{{Key: "$set", Value: bson.D{{Key: "api_key_hash", Value: hash}, {Key: "api_key_lookup", Value: lookup}, {Key: "updated_at", Value: updatedAt.UTC().Format(time.RFC3339)}}}}
    if expiresAt != nil {
        update = bson.D{{Key: "$set", Value: bson.D{{Key: "api_key_hash", Value: hash}, {Key: "api_key_lookup", Value: lookup}, {Key: "api_key_expires_at", Value: expiresAt.UTC().Format(time.RFC3339)}, {Key: "updated_at", Value: updatedAt.UTC().Format(time.RFC3339)}}}}
    }
    _, err := r.col().UpdateOne(ctx, bson.D{{Key: "user_id", Value: userID}}, update)
    return err
}

func (r *UserRepo) UpdateName(ctx context.Context, userID string, name string, updatedAt time.Time) error {
    _, err := r.col().UpdateOne(ctx, bson.D{{Key: "user_id", Value: userID}}, bson.D{{Key: "$set", Value: bson.D{{Key: "name", Value: name}, {Key: "updated_at", Value: updatedAt.UTC().Format(time.RFC3339)}}}})
    return err
}

func (r *UserRepo) SetRoomID(ctx context.Context, userID string, roomID *string, updatedAt time.Time) error {
    set := bson.D{{Key: "updated_at", Value: updatedAt.UTC().Format(time.RFC3339)}}
    if roomID == nil || *roomID == "" {
        set = append(set, bson.E{Key: "room_id", Value: nil})
    } else {
        set = append(set, bson.E{Key: "room_id", Value: *roomID})
    }
    _, err := r.col().UpdateOne(ctx, bson.D{{Key: "user_id", Value: userID}}, bson.D{{Key: "$set", Value: set}})
    return err
}
