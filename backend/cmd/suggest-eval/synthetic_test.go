package main

import (
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics/eval"
	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/internal/trips"
)

// The synthetic year is deterministic, and measuring it in home time may not lower the hit rate.
func TestSyntheticHomeTimeDoesNotLowerTheHitRate(t *testing.T) {
	evs, houses := synthetic(20261017)
	again, _ := synthetic(20261017)
	if len(evs) != len(again) || len(evs) == 0 {
		t.Fatalf("not deterministic: %d vs %d", len(evs), len(again))
	}
	away := map[string]predict.Away{}
	for _, h := range houses {
		away[h.room] = trips.HouseAway(h.trips, h.members, "UTC")
	}
	series := eval.GroupEvents(evs)
	wall := eval.Replay(series, predict.DefaultParams)
	home := eval.ReplayAway(series, predict.DefaultParams, away)
	if home.Precision() < wall.Precision() || home.Qualifying < wall.Qualifying {
		t.Fatalf("home %.3f (%d items) < wall %.3f (%d items)", home.Precision(), home.Qualifying, wall.Precision(), wall.Qualifying)
	}
}
