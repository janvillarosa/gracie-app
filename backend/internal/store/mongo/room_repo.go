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

type RoomRepo struct{ db *mgo.Database }

func NewRoomRepo(c *Client) *RoomRepo { return &RoomRepo{db: c.DB} }

func (r *RoomRepo) col() *mgo.Collection { return r.db.Collection("rooms") }

func (r *RoomRepo) EnsureIndexes(ctx context.Context) error {
    _, err := r.col().Indexes().CreateMany(ctx, []mgo.IndexModel{
        {Keys: bson.D{{Key: "room_id", Value: 1}}, Options: options.Index().SetUnique(true)},
        {Keys: bson.D{{Key: "share_token", Value: 1}}},
    })
    return err
}

func (r *RoomRepo) Put(ctx context.Context, rm *models.Room) error {
    _, err := r.col().InsertOne(ctx, rm)
    return err
}

func (r *RoomRepo) GetByID(ctx context.Context, id string) (*models.Room, error) {
    var rm models.Room
    err := r.col().FindOne(ctx, bson.D{{Key: "room_id", Value: id}}).Decode(&rm)
    if err != nil {
        if err == mgo.ErrNoDocuments { return nil, derr.ErrNotFound }
        return nil, err
    }
    return &rm, nil
}

func (r *RoomRepo) GetByShareToken(ctx context.Context, token string) (*models.Room, error) {
    var rm models.Room
    err := r.col().FindOne(ctx, bson.D{{Key: "share_token", Value: token}}).Decode(&rm)
    if err != nil {
        if err == mgo.ErrNoDocuments { return nil, derr.ErrNotFound }
        return nil, err
    }
    return &rm, nil
}

func (r *RoomRepo) SetShareToken(ctx context.Context, roomID string, userID string, token string, updatedAt time.Time) error {
    _, err := r.col().UpdateOne(ctx,
        bson.D{{Key: "room_id", Value: roomID}, {Key: "member_ids", Value: bson.D{{Key: "$in", Value: bson.A{userID}}}}},
        bson.D{{Key: "$set", Value: bson.D{{Key: "share_token", Value: token}, {Key: "updated_at", Value: updatedAt.UTC()}}}},
    )
    return err
}

func (r *RoomRepo) RemoveShareToken(ctx context.Context, roomID string, updatedAt time.Time) error {
    _, err := r.col().UpdateOne(ctx,
        bson.D{{Key: "room_id", Value: roomID}},
        bson.D{{Key: "$unset", Value: bson.D{{Key: "share_token", Value: ""}}}, {Key: "$set", Value: bson.D{{Key: "updated_at", Value: updatedAt.UTC()}}}},
    )
    return err
}

func (r *RoomRepo) UpdateDescription(ctx context.Context, roomID string, userID string, description string, updatedAt time.Time) error {
    if description == "" {
        _, err := r.col().UpdateOne(ctx,
            bson.D{{Key: "room_id", Value: roomID}, {Key: "member_ids", Value: bson.D{{Key: "$in", Value: bson.A{userID}}}}},
            bson.D{{Key: "$unset", Value: bson.D{{Key: "description", Value: ""}}}, {Key: "$set", Value: bson.D{{Key: "updated_at", Value: updatedAt.UTC()}}}},
        )
        return err
    }
    _, err := r.col().UpdateOne(ctx,
        bson.D{{Key: "room_id", Value: roomID}, {Key: "member_ids", Value: bson.D{{Key: "$in", Value: bson.A{userID}}}}},
        bson.D{{Key: "$set", Value: bson.D{{Key: "description", Value: description}, {Key: "updated_at", Value: updatedAt.UTC()}}}},
    )
    return err
}

func (r *RoomRepo) UpdateDisplayName(ctx context.Context, roomID string, userID string, displayName string, updatedAt time.Time) error {
    _, err := r.col().UpdateOne(ctx,
        bson.D{{Key: "room_id", Value: roomID}, {Key: "member_ids", Value: bson.D{{Key: "$in", Value: bson.A{userID}}}}},
        bson.D{{Key: "$set", Value: bson.D{{Key: "display_name", Value: displayName}, {Key: "updated_at", Value: updatedAt.UTC()}}}},
    )
    return err
}

func (r *RoomRepo) VoteDeletion(ctx context.Context, roomID string, userID string, ts time.Time) error {
    _, err := r.col().UpdateOne(ctx, bson.D{{Key: "room_id", Value: roomID}}, bson.D{{Key: "$set", Value: bson.D{{Key: "deletion_votes." + userID, Value: ts.UTC().Format(time.RFC3339)}, {Key: "updated_at", Value: ts.UTC()}}}})
    return err
}

func (r *RoomRepo) RemoveDeletionVote(ctx context.Context, roomID string, userID string) error {
    _, err := r.col().UpdateOne(ctx, bson.D{{Key: "room_id", Value: roomID}}, bson.D{{Key: "$unset", Value: bson.D{{Key: "deletion_votes." + userID, Value: ""}}}})
    return err
}

func (r *RoomRepo) Delete(ctx context.Context, roomID string) error {
    _, err := r.col().DeleteOne(ctx, bson.D{{Key: "room_id", Value: roomID}})
    return err
}

func (r *RoomRepo) AddMember(ctx context.Context, roomID string, userID string, updatedAt time.Time) error {
    // add userID if not present and ensure max two members by checking in service
    _, err := r.col().UpdateOne(ctx, bson.D{{Key: "room_id", Value: roomID}}, bson.D{{Key: "$addToSet", Value: bson.D{{Key: "member_ids", Value: userID}}}, {Key: "$set", Value: bson.D{{Key: "updated_at", Value: updatedAt.UTC()}}}})
    return err
}
