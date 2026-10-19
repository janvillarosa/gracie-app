package main

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/internal/autopilot"
	"github.com/janvillarosa/gracie-app/backend/internal/autopilot/replay"
	mongostore "github.com/janvillarosa/gracie-app/backend/internal/store/mongo"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/households"
	"go.mongodb.org/mongo-driver/bson"
)

// upNextSynthetic replays the route personas (internal/testutil/households) on six seeds.
func upNextSynthetic() {
	p := autopilot.DefaultPolicy
	fmt.Printf("up next bar: >= %d runs, score >= %.2f\n", p.UpNextMinRuns, p.UpNextMinScore)
	var all replay.UpNextScore
	for seed := int64(1); seed <= 6; seed++ {
		for _, h := range households.Routes(seed) {
			s := replay.UpNext(h.Runs, p)
			all.Add(s)
			if seed == 1 {
				fmt.Printf("  %-13s runs %2d  spoke %2d (%3.0f%%)  hits %3d/%-3d  %5.1f%%\n", h.Persona, s.Runs, s.Spoke, 100*s.Coverage(), s.Hits, s.Trials, 100*s.HitRate())
			}
		}
	}
	upNextTotal("six seeds, pooled", all)
}

// upNextReport replays every house's lists from their check-off history, as the profile would
// have learned them: the numbers to read before deploy (the real-data gate).
func upNextReport(ctx context.Context, cli *mongostore.Client, room string) {
	evs := loadEvents(ctx, cli, roomFilter(room, bson.D{{Key: "subject.type", Value: "item"}, {Key: "name", Value: "item.checked"}}))
	type listKey struct{ room, list string }
	byList := map[listKey][]analytics.Event{}
	for _, e := range evs {
		if e.Container == nil || e.Container.Type != "list" || e.Key == "" {
			continue
		}
		k := listKey{e.RoomID, e.Container.ID}
		byList[k] = append(byList[k], e)
	}
	keys := make([]listKey, 0, len(byList))
	for k := range byList {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i].room+keys[i].list < keys[j].room+keys[j].list })
	p := autopilot.DefaultPolicy
	var all replay.UpNextScore
	for _, k := range keys {
		es := byList[k]
		ts := make([]time.Time, len(es))
		for i, e := range es {
			ts[i] = e.OccurredAt
		}
		spans := predict.RunSpans(ts)
		orders := analytics.RunOrders(es, spans)
		runs := make([][]string, len(orders))
		for i, o := range orders {
			runs[i] = o
		}
		s := replay.UpNext(runs, p)
		all.Add(s)
		fmt.Printf("  %s/%s  runs %2d  spoke %2d (%3.0f%%)  hits %3d/%-3d  %5.1f%%\n", k.room, k.list, s.Runs, s.Spoke, 100*s.Coverage(), s.Hits, s.Trials, 100*s.HitRate())
	}
	upNextTotal("all lists, pooled", all)
}

func upNextTotal(label string, s replay.UpNextScore) {
	gate := s.Trials > 0 && s.HitRate() >= replay.UpNextHitGate
	fmt.Printf("%s: runs %d  spoke %d (%.0f%%)  hits %d/%d  %.1f%%  gate (>= %.0f%% where it speaks): %v\n",
		label, s.Runs, s.Spoke, 100*s.Coverage(), s.Hits, s.Trials, 100*s.HitRate(), 100*replay.UpNextHitGate,
		map[bool]string{true: "PASS", false: "MISS"}[gate])
}
