package memstore

import (
	"context"
	"slices"
	"sort"
	"sync"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/pkg/ids"
)

// pushMaxNames mirrors store/mongo's maxNames.
const pushMaxNames = 5

// PushRepo mirrors store/mongo.PushRepo: subscriptions unique by endpoint, and the outbox with one
// pending job per coalesce key.
type PushRepo struct {
	mu   sync.Mutex
	subs map[string]*models.PushSubscription // by endpoint
	jobs []*models.PushJob
}

func NewPushRepo() *PushRepo { return &PushRepo{subs: map[string]*models.PushSubscription{}} }

func (r *PushRepo) Upsert(_ context.Context, s *models.PushSubscription) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if cur, ok := r.subs[s.Endpoint]; ok {
		cur.UserID, cur.P256dhEnc, cur.AuthEnc, cur.UserAgent, cur.UpdatedAt = s.UserID, s.P256dhEnc, s.AuthEnc, s.UserAgent, s.UpdatedAt
		return nil
	}
	cp := *s
	r.subs[s.Endpoint] = &cp
	return nil
}

func (r *PushRepo) DeleteForUser(_ context.Context, userID, endpoint string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok := r.subs[endpoint]; ok && s.UserID == userID {
		delete(r.subs, endpoint)
	}
	return nil
}

func (r *PushRepo) DeleteEndpoint(_ context.Context, endpoint string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.subs, endpoint)
	return nil
}

func (r *PushRepo) DeleteByUser(_ context.Context, userID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for ep, s := range r.subs {
		if s.UserID == userID {
			delete(r.subs, ep)
		}
	}
	return nil
}

func (r *PushRepo) ListByUsers(_ context.Context, userIDs []string) ([]models.PushSubscription, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []models.PushSubscription
	for _, s := range r.subs {
		if slices.Contains(userIDs, s.UserID) {
			out = append(out, *s)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out, nil
}

func (r *PushRepo) MarkOK(_ context.Context, endpoint string, at time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok := r.subs[endpoint]; ok {
		t := at
		s.LastOKAt = &t
	}
	return nil
}

func (r *PushRepo) Enqueue(_ context.Context, j *models.PushJob, once bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, x := range r.jobs {
		if x.CoalesceKey == j.CoalesceKey && (once || x.Status == models.PushJobPending) {
			x.Count += max(j.Count, 1)
			for _, n := range j.Names {
				if len(x.Names) < pushMaxNames {
					x.Names = append(x.Names, n)
				}
			}
			return nil
		}
	}
	cp := *j
	if cp.JobID == "" {
		cp.JobID = ids.NewID("pj")
	}
	cp.Status, cp.Attempts, cp.Count = models.PushJobPending, 0, max(j.Count, 1)
	cp.Names = slices.Clone(j.Names)
	if len(cp.Names) > pushMaxNames {
		cp.Names = cp.Names[:pushMaxNames]
	}
	r.jobs = append(r.jobs, &cp)
	return nil
}

func (r *PushRepo) Claim(_ context.Context, now time.Time, lease time.Duration) (*models.PushJob, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var best *models.PushJob
	for _, x := range r.jobs {
		due := (x.Status == models.PushJobPending && !x.SendAfter.After(now)) ||
			(x.Status == models.PushJobSending && x.LeaseUntil != nil && x.LeaseUntil.Before(now))
		if due && (best == nil || x.SendAfter.Before(best.SendAfter)) {
			best = x
		}
	}
	if best == nil {
		return nil, nil
	}
	until := now.Add(lease)
	best.Status, best.LeaseUntil = models.PushJobSending, &until
	best.Attempts++
	cp := *best
	cp.Names = slices.Clone(best.Names)
	return &cp, nil
}

func (r *PushRepo) Finish(_ context.Context, jobID string, expireAt time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if j := r.find(jobID); j != nil {
		j.Status, j.ExpireAt, j.LeaseUntil = models.PushJobDone, expireAt, nil
	}
	return nil
}

func (r *PushRepo) Retry(_ context.Context, jobID string, sendAfter time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	j := r.find(jobID)
	if j == nil {
		return nil
	}
	for _, x := range r.jobs {
		if x != j && x.CoalesceKey == j.CoalesceKey && x.Status == models.PushJobPending {
			j.Status, j.LeaseUntil = models.PushJobDone, nil
			return nil
		}
	}
	j.Status, j.SendAfter, j.LeaseUntil = models.PushJobPending, sendAfter, nil
	return nil
}

func (r *PushRepo) find(jobID string) *models.PushJob {
	for _, x := range r.jobs {
		if x.JobID == jobID {
			return x
		}
	}
	return nil
}

// Jobs returns a copy of every job, for test assertions.
func (r *PushRepo) Jobs() []models.PushJob {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]models.PushJob, 0, len(r.jobs))
	for _, x := range r.jobs {
		out = append(out, *x)
	}
	return out
}

func (r *PushRepo) EnqueueRun(_ context.Context, j *models.PushJob, gap time.Duration, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	name := ""
	if len(j.Names) > 0 {
		name = j.Names[0]
	}
	for _, x := range r.jobs {
		if x.CoalesceKey != j.CoalesceKey || x.LastAt == nil || x.LastAt.Before(now.Add(-gap)) {
			continue
		}
		if now.After(*x.LastAt) {
			t := now
			x.LastAt = &t
		}
		if x.Status == models.PushJobPending && !slices.Contains(x.Names, name) {
			x.Count++
			if len(x.Names) < pushMaxNames {
				x.Names = append(x.Names, name)
			}
		}
		return nil
	}
	cp := *j
	if cp.JobID == "" {
		cp.JobID = ids.NewID("pj")
	}
	t := now
	cp.Status, cp.Attempts, cp.Count, cp.LastAt = models.PushJobPending, 0, 1, &t
	cp.Names = slices.Clone(j.Names[:min(len(j.Names), 1)])
	r.jobs = append(r.jobs, &cp)
	return nil
}
