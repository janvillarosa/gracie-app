package mongo

import (
	"context"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
	"go.mongodb.org/mongo-driver/bson"
	mgo "go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// BackfillReader streams whole collections through batched cursors for the analytics backfill.
type BackfillReader struct{ db *mgo.Database }

func NewBackfillReader(c *Client) *BackfillReader { return &BackfillReader{db: c.DB} }

const backfillBatch = 500

// each decodes one document at a time so memory stays flat however large the collection is.
func each[T any](ctx context.Context, col *mgo.Collection, filter bson.D, opts *options.FindOptions, fn func(T) error) error {
	cur, err := col.Find(ctx, filter, opts.SetBatchSize(backfillBatch))
	if err != nil {
		return err
	}
	defer func() { _ = cur.Close(ctx) }()
	for cur.Next(ctx) {
		var v T
		if err := cur.Decode(&v); err != nil {
			return err
		}
		if err := fn(v); err != nil {
			return err
		}
	}
	return cur.Err()
}

func roomFilter(roomID string) bson.D {
	if roomID == "" {
		return bson.D{}
	}
	return bson.D{{Key: "room_id", Value: roomID}}
}

// userProjection is an allow-list: the backfill never loads password, API key or lookup fields.
var userProjection = bson.D{
	{Key: "user_id", Value: 1}, {Key: "room_id", Value: 1}, {Key: "tz", Value: 1},
	{Key: "created_at", Value: 1}, {Key: "updated_at", Value: 1},
}

func (r *BackfillReader) EachUser(ctx context.Context, roomID string, fn func(models.User) error) error {
	return each(ctx, r.db.Collection("users"), roomFilter(roomID),
		options.Find().SetProjection(userProjection).SetSort(bson.D{{Key: "user_id", Value: 1}}), fn)
}

func (r *BackfillReader) EachRoom(ctx context.Context, roomID string, fn func(models.Room) error) error {
	filter := bson.D{}
	if roomID != "" {
		filter = bson.D{{Key: "room_id", Value: roomID}}
	}
	return each(ctx, r.db.Collection("rooms"), filter,
		options.Find().SetProjection(bson.D{{Key: "room_id", Value: 1}, {Key: "member_ids", Value: 1}, {Key: "created_at", Value: 1}}).
			SetSort(bson.D{{Key: "room_id", Value: 1}}), fn)
}

func (r *BackfillReader) EachList(ctx context.Context, roomID string, fn func(models.List) error) error {
	return each(ctx, r.db.Collection("lists"), roomFilter(roomID),
		options.Find().SetProjection(bson.D{{Key: "list_id", Value: 1}, {Key: "room_id", Value: 1}, {Key: "is_deleted", Value: 1}, {Key: "created_at", Value: 1}}).
			SetSort(bson.D{{Key: "list_id", Value: 1}}), fn)
}

// EachItem keeps the description because the event key is derived from it; it is normalized
// before anything is stored and never leaves the process.
func (r *BackfillReader) EachItem(ctx context.Context, roomID string, fn func(models.ListItem) error) error {
	return each(ctx, r.db.Collection("list_items"), roomFilter(roomID),
		options.Find().SetProjection(bson.D{
			{Key: "item_id", Value: 1}, {Key: "list_id", Value: 1}, {Key: "room_id", Value: 1}, {Key: "description", Value: 1},
			{Key: "category", Value: 1}, {Key: "completed", Value: 1}, {Key: "is_archived", Value: 1},
			{Key: "created_by", Value: 1}, {Key: "completed_at", Value: 1}, {Key: "completed_by", Value: 1},
			{Key: "created_at", Value: 1}, {Key: "updated_at", Value: 1},
		}).SetSort(bson.D{{Key: "item_id", Value: 1}}), fn)
}

// EachTrip loads whole documents: todos are embedded, and trip notes or places are never read by the backfill.
func (r *BackfillReader) EachTrip(ctx context.Context, roomID string, fn func(models.Trip) error) error {
	return each(ctx, r.db.Collection("trips"), roomFilter(roomID),
		options.Find().SetProjection(bson.D{
			{Key: "trip_id", Value: 1}, {Key: "room_id", Value: 1}, {Key: "start_date", Value: 1}, {Key: "tz", Value: 1},
			{Key: "created_by", Value: 1}, {Key: "created_at", Value: 1}, {Key: "deleted_at", Value: 1}, {Key: "deleted_by", Value: 1},
			{Key: "todos.todo_id", Value: 1}, {Key: "todos.category", Value: 1}, {Key: "todos.done", Value: 1},
			{Key: "todos.done_by", Value: 1}, {Key: "todos.done_at", Value: 1},
		}).SetSort(bson.D{{Key: "trip_id", Value: 1}}), fn)
}

var _ store.BackfillReader = (*BackfillReader)(nil)
