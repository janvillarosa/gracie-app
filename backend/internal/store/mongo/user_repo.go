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

func filterByUserID(userID string) bson.D {
    // Support legacy documents that may have been written without bson tags ("userid")
    return bson.D{{Key: "$or", Value: bson.A{bson.D{{Key: "user_id", Value: userID}}, bson.D{{Key: "userid", Value: userID}}}}}
}

func (r *UserRepo) EnsureIndexes(ctx context.Context) error {
    idx := r.col().Indexes()
    // Drop legacy non-partial unique index on api_key_lookup if present
    cur, err := idx.List(ctx)
    if err == nil {
        for cur.Next(ctx) {
            var m bson.M
            _ = cur.Decode(&m)
            if name, _ := m["name"].(string); name == "api_key_lookup_1" {
                _, _ = idx.DropOne(ctx, name)
            }
        }
        _ = cur.Close(ctx)
    }
    // Create desired indexes (idempotent)
    _, err = idx.CreateMany(ctx, []mgo.IndexModel{
        {
            Keys:    bson.D{{Key: "username", Value: 1}},
            Options: options.Index().SetUnique(true).SetName("username_unique"),
        },
        {
            Keys: bson.D{{Key: "api_key_lookup", Value: 1}},
            Options: options.Index().
                SetUnique(true).
                SetName("api_key_lookup_unique").
                // Only index docs where api_key_lookup is a string (present)
                SetPartialFilterExpression(bson.D{{Key: "api_key_lookup", Value: bson.D{{Key: "$type", Value: "string"}}}}),
        },
        {
            Keys:    bson.D{{Key: "user_id", Value: 1}},
            Options: options.Index().SetUnique(true).SetName("user_id_unique"),
        },
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
    err := r.col().FindOne(ctx, filterByUserID(id)).Decode(&u)
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
    setDoc := bson.D{{Key: "api_key_hash", Value: hash}, {Key: "api_key_lookup", Value: lookup}, {Key: "updated_at", Value: updatedAt.UTC()}}
    if expiresAt != nil {
        setDoc = append(setDoc, bson.E{Key: "api_key_expires_at", Value: expiresAt.UTC()})
    }
    update := bson.D{{Key: "$set", Value: setDoc}}
    _, err := r.col().UpdateOne(ctx, filterByUserID(userID), update)
    return err
}

func (r *UserRepo) UpdateName(ctx context.Context, userID string, name string, updatedAt time.Time) error {
    _, err := r.col().UpdateOne(ctx, filterByUserID(userID), bson.D{{Key: "$set", Value: bson.D{{Key: "name", Value: name}, {Key: "updated_at", Value: updatedAt.UTC()}}}})
    return err
}

func (r *UserRepo) SetRoomID(ctx context.Context, userID string, roomID *string, updatedAt time.Time) error {
    if roomID == nil || *roomID == "" {
        _, err := r.col().UpdateOne(ctx, filterByUserID(userID), bson.D{{Key: "$unset", Value: bson.D{{Key: "room_id", Value: ""}}}, {Key: "$set", Value: bson.D{{Key: "updated_at", Value: updatedAt.UTC()}}}})
        return err
    }
    _, err := r.col().UpdateOne(ctx, filterByUserID(userID), bson.D{{Key: "$set", Value: bson.D{{Key: "room_id", Value: *roomID}, {Key: "updated_at", Value: updatedAt.UTC()}}}})
    return err
}

func (r *UserRepo) UpdateUsername(ctx context.Context, userID string, username string, updatedAt time.Time) error {
    _, err := r.col().UpdateOne(ctx, filterByUserID(userID), bson.D{{Key: "$set", Value: bson.D{{Key: "username", Value: username}, {Key: "updated_at", Value: updatedAt.UTC()}}}})
    return err
}

func (r *UserRepo) UpdatePasswordEnc(ctx context.Context, userID string, enc string, updatedAt time.Time) error {
    _, err := r.col().UpdateOne(ctx, filterByUserID(userID), bson.D{{Key: "$set", Value: bson.D{{Key: "password_enc", Value: enc}, {Key: "updated_at", Value: updatedAt.UTC()}}}})
    return err
}

func (r *UserRepo) Delete(ctx context.Context, userID string) error {
    _, err := r.col().DeleteOne(ctx, filterByUserID(userID))
    return err
}
