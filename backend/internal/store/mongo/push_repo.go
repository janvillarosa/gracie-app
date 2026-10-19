package mongo

import (
	"context"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/pkg/ids"
	"go.mongodb.org/mongo-driver/bson"
	mgo "go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// maxNames is how many item names a merged job keeps; the rest only count.
const maxNames = 5

// PushRepo stores push_subscriptions and the push_jobs outbox.
type PushRepo struct{ db *mgo.Database }

func NewPushRepo(c *Client) *PushRepo { return &PushRepo{db: c.DB} }

func (r *PushRepo) subs() *mgo.Collection { return r.db.Collection("push_subscriptions") }
func (r *PushRepo) jobs() *mgo.Collection { return r.db.Collection("push_jobs") }

func (r *PushRepo) EnsureIndexes(ctx context.Context) error {
	if _, err := r.subs().Indexes().CreateMany(ctx, []mgo.IndexModel{
		{Keys: bson.D{{Key: "endpoint", Value: 1}}, Options: options.Index().SetUnique(true)},
		{Keys: bson.D{{Key: "user_id", Value: 1}, {Key: "created_at", Value: 1}}},
		{Keys: bson.D{{Key: "session_id", Value: 1}}, Options: options.Index().SetSparse(true)},
	}); err != nil {
		return err
	}
	_, err := r.jobs().Indexes().CreateMany(ctx, []mgo.IndexModel{
		{Keys: bson.D{{Key: "job_id", Value: 1}}, Options: options.Index().SetUnique(true)},
		// One pending job per key, however many instances enqueue at once.
		{Keys: bson.D{{Key: "coalesce_key", Value: 1}}, Options: options.Index().SetUnique(true).SetName("coalesce_pending").
			SetPartialFilterExpression(bson.D{{Key: "status", Value: models.PushJobPending}})},
		{Keys: bson.D{{Key: "coalesce_key", Value: 1}, {Key: "status", Value: 1}}},
		{Keys: bson.D{{Key: "status", Value: 1}, {Key: "send_after", Value: 1}}},
		{Keys: bson.D{{Key: "expire_at", Value: 1}}, Options: options.Index().SetExpireAfterSeconds(0).SetName("expire_at_ttl")},
	})
	return err
}

// Subscriptions

func (r *PushRepo) Upsert(ctx context.Context, s *models.PushSubscription) error {
	_, err := r.subs().UpdateOne(ctx, bson.D{{Key: "endpoint", Value: s.Endpoint}}, bson.D{
		{Key: "$set", Value: bson.D{
			{Key: "user_id", Value: s.UserID}, {Key: "session_id", Value: s.SessionID}, {Key: "p256dh_enc", Value: s.P256dhEnc}, {Key: "auth_enc", Value: s.AuthEnc},
			{Key: "user_agent", Value: s.UserAgent}, {Key: "updated_at", Value: s.UpdatedAt.UTC()},
		}},
		{Key: "$setOnInsert", Value: bson.D{{Key: "sub_id", Value: s.SubID}, {Key: "created_at", Value: s.CreatedAt.UTC()}}},
	}, options.Update().SetUpsert(true))
	if mgo.IsDuplicateKeyError(err) {
		// Two upserts of a new endpoint raced; the loser's update now matches.
		_, err = r.subs().UpdateOne(ctx, bson.D{{Key: "endpoint", Value: s.Endpoint}}, bson.D{{Key: "$set", Value: bson.D{
			{Key: "user_id", Value: s.UserID}, {Key: "session_id", Value: s.SessionID}, {Key: "p256dh_enc", Value: s.P256dhEnc}, {Key: "auth_enc", Value: s.AuthEnc},
			{Key: "user_agent", Value: s.UserAgent}, {Key: "updated_at", Value: s.UpdatedAt.UTC()},
		}}})
	}
	return err
}

func (r *PushRepo) DeleteForUser(ctx context.Context, userID, endpoint string) error {
	_, err := r.subs().DeleteOne(ctx, bson.D{{Key: "endpoint", Value: endpoint}, {Key: "user_id", Value: userID}})
	return err
}

func (r *PushRepo) DeleteEndpoint(ctx context.Context, endpoint string) error {
	_, err := r.subs().DeleteOne(ctx, bson.D{{Key: "endpoint", Value: endpoint}})
	return err
}

func (r *PushRepo) DeleteByUser(ctx context.Context, userID string) error {
	_, err := r.subs().DeleteMany(ctx, bson.D{{Key: "user_id", Value: userID}})
	return err
}

func (r *PushRepo) DeleteBySessions(ctx context.Context, sessionIDs []string) error {
	if len(sessionIDs) == 0 {
		return nil
	}
	_, err := r.subs().DeleteMany(ctx, bson.D{{Key: "session_id", Value: bson.D{{Key: "$in", Value: sessionIDs}}}})
	return err
}

func (r *PushRepo) ListByUsers(ctx context.Context, userIDs []string) ([]models.PushSubscription, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}
	cur, err := r.subs().Find(ctx, bson.D{{Key: "user_id", Value: bson.D{{Key: "$in", Value: userIDs}}}},
		options.Find().SetSort(bson.D{{Key: "created_at", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var out []models.PushSubscription
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (r *PushRepo) MarkOK(ctx context.Context, endpoint string, at time.Time) error {
	_, err := r.subs().UpdateOne(ctx, bson.D{{Key: "endpoint", Value: endpoint}}, bson.D{{Key: "$set", Value: bson.D{{Key: "last_ok_at", Value: at.UTC()}}}})
	return err
}

// Jobs

func (r *PushRepo) Enqueue(ctx context.Context, j *models.PushJob, once bool) error {
	filter := bson.D{{Key: "coalesce_key", Value: j.CoalesceKey}}
	if !once {
		filter = append(filter, bson.E{Key: "status", Value: models.PushJobPending})
	}
	jobID := j.JobID
	if jobID == "" {
		jobID = ids.NewID("pj")
	}
	update := bson.D{
		{Key: "$setOnInsert", Value: bson.D{
			{Key: "job_id", Value: jobID}, {Key: "kind", Value: j.Kind}, {Key: "room_id", Value: j.RoomID},
			{Key: "actor_id", Value: j.ActorID}, {Key: "recipients", Value: j.Recipients}, {Key: "list_id", Value: j.ListID},
			{Key: "url", Value: j.URL}, {Key: "title", Value: j.Title}, {Key: "body", Value: j.Body},
			{Key: "status", Value: models.PushJobPending}, {Key: "send_after", Value: j.SendAfter.UTC()},
			{Key: "attempts", Value: 0}, {Key: "created_at", Value: j.CreatedAt.UTC()}, {Key: "expire_at", Value: j.ExpireAt.UTC()},
		}},
		{Key: "$inc", Value: bson.D{{Key: "count", Value: max(j.Count, 1)}}},
	}
	if len(j.Names) > 0 {
		update = append(update, bson.E{Key: "$push", Value: bson.D{{Key: "names", Value: bson.D{
			{Key: "$each", Value: j.Names}, {Key: "$slice", Value: maxNames},
		}}}})
	}
	opts := options.Update().SetUpsert(true)
	_, err := r.jobs().UpdateOne(ctx, filter, update, opts)
	if mgo.IsDuplicateKeyError(err) {
		// Another instance inserted the pending job first: merge into it.
		_, err = r.jobs().UpdateOne(ctx, filter, update, opts)
	}
	return err
}

func (r *PushRepo) Claim(ctx context.Context, now time.Time, lease time.Duration) (*models.PushJob, error) {
	now = now.UTC()
	filter := bson.D{{Key: "$or", Value: bson.A{
		bson.D{{Key: "status", Value: models.PushJobPending}, {Key: "send_after", Value: bson.D{{Key: "$lte", Value: now}}}},
		bson.D{{Key: "status", Value: models.PushJobSending}, {Key: "lease_until", Value: bson.D{{Key: "$lt", Value: now}}}},
	}}}
	update := bson.D{
		{Key: "$set", Value: bson.D{{Key: "status", Value: models.PushJobSending}, {Key: "lease_until", Value: now.Add(lease)}}},
		{Key: "$inc", Value: bson.D{{Key: "attempts", Value: 1}}},
	}
	var j models.PushJob
	err := r.jobs().FindOneAndUpdate(ctx, filter, update, options.FindOneAndUpdate().
		SetSort(bson.D{{Key: "send_after", Value: 1}}).SetReturnDocument(options.After)).Decode(&j)
	if err == mgo.ErrNoDocuments {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &j, nil
}

func (r *PushRepo) Finish(ctx context.Context, jobID string, expireAt time.Time) error {
	_, err := r.jobs().UpdateOne(ctx, bson.D{{Key: "job_id", Value: jobID}}, bson.D{
		{Key: "$set", Value: bson.D{{Key: "status", Value: models.PushJobDone}, {Key: "expire_at", Value: expireAt.UTC()}}},
		{Key: "$unset", Value: bson.D{{Key: "lease_until", Value: ""}}},
	})
	return err
}

func (r *PushRepo) Retry(ctx context.Context, jobID string, sendAfter time.Time) error {
	_, err := r.jobs().UpdateOne(ctx, bson.D{{Key: "job_id", Value: jobID}}, bson.D{
		{Key: "$set", Value: bson.D{{Key: "status", Value: models.PushJobPending}, {Key: "send_after", Value: sendAfter.UTC()}}},
		{Key: "$unset", Value: bson.D{{Key: "lease_until", Value: ""}}},
	})
	if mgo.IsDuplicateKeyError(err) {
		// A newer pending job holds the key: give up on this one rather than lose the newer adds.
		return r.Finish(ctx, jobID, sendAfter.Add(7*24*time.Hour))
	}
	return err
}

func (r *PushRepo) EnqueueRun(ctx context.Context, j *models.PushJob, gap time.Duration, now time.Time) error {
	now = now.UTC()
	name := ""
	if len(j.Names) > 0 {
		name = j.Names[0]
	}
	filter := bson.D{{Key: "coalesce_key", Value: j.CoalesceKey}, {Key: "last_at", Value: bson.D{{Key: "$gte", Value: now.Add(-gap)}}}}
	names := bson.D{{Key: "$ifNull", Value: bson.A{"$names", bson.A{}}}}
	// Only a pending job still takes the event into its message, and a repeated name (uncheck,
	// recheck) only once; a claimed or sent job just keeps the run alive.
	takes := bson.D{{Key: "$and", Value: bson.A{
		bson.D{{Key: "$eq", Value: bson.A{"$status", models.PushJobPending}}},
		bson.D{{Key: "$not", Value: bson.A{bson.D{{Key: "$in", Value: bson.A{name, names}}}}}},
	}}}
	update := mgo.Pipeline{{{Key: "$set", Value: bson.D{
		{Key: "last_at", Value: bson.D{{Key: "$max", Value: bson.A{"$last_at", now}}}},
		{Key: "count", Value: bson.D{{Key: "$cond", Value: bson.A{takes, bson.D{{Key: "$add", Value: bson.A{"$count", 1}}}, "$count"}}}},
		{Key: "names", Value: bson.D{{Key: "$cond", Value: bson.A{
			bson.D{{Key: "$and", Value: bson.A{takes, bson.D{{Key: "$lt", Value: bson.A{bson.D{{Key: "$size", Value: names}}, maxNames}}}}}},
			bson.D{{Key: "$concatArrays", Value: bson.A{names, bson.A{name}}}},
			names,
		}}}},
	}}}}
	merge := func() (bool, error) {
		res, err := r.jobs().UpdateOne(ctx, filter, update)
		return err == nil && res.MatchedCount > 0, err
	}
	if ok, err := merge(); ok || err != nil {
		return err
	}
	job := *j
	if job.JobID == "" {
		job.JobID = ids.NewID("pj")
	}
	job.Status, job.Attempts, job.Count, job.LastAt = models.PushJobPending, 0, 1, &now
	job.Names = job.Names[:min(len(job.Names), 1)]
	if _, err := r.jobs().InsertOne(ctx, &job); err != nil {
		if mgo.IsDuplicateKeyError(err) {
			// Another instance started the run first: merge into it.
			_, err = merge()
		}
		return err
	}
	return nil
}
