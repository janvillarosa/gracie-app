package memstore

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
)

func (r *EventRepo) since(match func(analytics.Event) bool, since time.Time, limit int) []analytics.Event {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []analytics.Event
	for _, e := range r.evs {
		if match(e) && !e.OccurredAt.Before(since) {
			out = append(out, e)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].OccurredAt.Before(out[j].OccurredAt) })
	if limit > 0 && len(out) > limit {
		out = out[len(out)-limit:]
	}
	return out
}

func (r *EventRepo) ListByActorSince(_ context.Context, userID string, since time.Time, limit int) ([]analytics.Event, error) {
	return r.since(func(e analytics.Event) bool { return e.ActorID == userID }, since, limit), nil
}

func (r *EventRepo) ListByRoomSince(_ context.Context, roomID string, since time.Time, limit int) ([]analytics.Event, error) {
	return r.since(func(e analytics.Event) bool { return e.RoomID == roomID }, since, limit), nil
}

func (r *AggRepo) ClaimDirty(_ context.Context, limit int) ([]string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var ids []string
	for s := range r.dirty {
		ids = append(ids, s)
	}
	sort.Strings(ids)
	if limit > 0 && len(ids) > limit {
		ids = ids[:limit]
	}
	for _, s := range ids {
		delete(r.dirty, s)
	}
	return ids, nil
}

func (r *AggRepo) MarkDirty(_ context.Context, subjects ...string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, s := range subjects {
		r.dirty[s] = true
	}
	return nil
}

func (r *AggRepo) RequeueStale(_ context.Context, before time.Time, limit int) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := 0
	for id, p := range r.profiles {
		if p.ComputedAt.Before(before) && !r.dirty[id] && (limit <= 0 || n < limit) {
			r.dirty[id] = true
			n++
		}
	}
	return n, nil
}

func (r *AggRepo) PutProfile(_ context.Context, p *analytics.Profile) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := *p
	r.profiles[p.ID] = &cp
	return nil
}

func (r *AggRepo) GetProfile(_ context.Context, id string) (*analytics.Profile, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if p, ok := r.profiles[id]; ok {
		cp := *p
		return &cp, nil
	}
	return nil, nil
}

func (r *AggRepo) GetPeriod(_ context.Context, id string) (map[string]any, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.periods[id], nil
}

func toKeyStat(doc map[string]any) analytics.KeyStat {
	ks := analytics.KeyStat{Counts: map[string]int64{}, LastAt: map[string]time.Time{}}
	ks.RoomID, _ = doc["room_id"].(string)
	ks.SubjectType, _ = doc["subject_type"].(string)
	ks.Key, _ = doc["key"].(string)
	ks.Category, _ = doc["category"].(string)
	ks.FirstAt, _ = doc["first_at"].(time.Time)
	if m, ok := doc["counts"].(map[string]any); ok {
		for k, v := range m {
			ks.Counts[k], _ = v.(int64)
		}
	}
	if m, ok := doc["last_at"].(map[string]any); ok {
		for k, v := range m {
			ks.LastAt[k], _ = v.(time.Time)
		}
	}
	if m, ok := doc["by_actor"].(map[string]any); ok {
		ks.ByActor = map[string]map[string]int64{}
		for actor, v := range m {
			verbs := map[string]int64{}
			if vm, ok := v.(map[string]any); ok {
				for verb, n := range vm {
					verbs[verb], _ = n.(int64)
				}
			}
			ks.ByActor[actor] = verbs
		}
	}
	if m, ok := doc["containers"].(map[string]any); ok {
		ks.Containers = map[string]int64{}
		for k, v := range m {
			ks.Containers[k], _ = v.(int64)
		}
	}
	if iv, ok := doc["intervals"].(analytics.KeyIntervals); ok {
		ks.Intervals = &iv
	}
	return ks
}

func (r *AggRepo) GetKeyStats(_ context.Context, roomID, subjectType string, keys []string) (map[string]analytics.KeyStat, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := map[string]analytics.KeyStat{}
	for _, k := range keys {
		if doc, ok := r.keys[roomID+":"+subjectType+":"+k]; ok {
			out[k] = toKeyStat(doc)
		}
	}
	return out, nil
}

func (r *AggRepo) DueKeys(_ context.Context, roomID, subjectType string, before time.Time, limit int) ([]analytics.KeyStat, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []analytics.KeyStat
	for id, doc := range r.keys {
		if !strings.HasPrefix(id, roomID+":"+subjectType+":") {
			continue
		}
		ks := toKeyStat(doc)
		if ks.Intervals != nil && ks.Intervals.DueAt != nil && ks.Intervals.DueAt.Before(before) {
			out = append(out, ks)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Intervals.DueAt.Before(*out[j].Intervals.DueAt) })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (r *AggRepo) UpcomingKeys(_ context.Context, roomID, subjectType string, now time.Time, minScore, maxCV float64, limit int) ([]analytics.KeyStat, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []analytics.KeyStat
	for id, doc := range r.keys {
		if !strings.HasPrefix(id, roomID+":"+subjectType+":") {
			continue
		}
		ks := toKeyStat(doc)
		if ks.Intervals == nil || ks.Intervals.Add == nil {
			continue
		}
		a := ks.Intervals.Add
		if !a.OpensAt.After(now) && !a.ClosesAt.Before(now) && a.Score >= minScore && a.CV <= maxCV {
			out = append(out, ks)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if si, sj := out[i].Intervals.Add.Score, out[j].Intervals.Add.Score; si != sj {
			return si > sj
		}
		return out[i].Key < out[j].Key
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}
