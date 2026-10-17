package replay

import (
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/testutil/households"
)

// The gate for offering assist: on the golden households, with the server's bars and lead,
// precision >= 0.85 and at most one removal per house-week, while still adding things.
func TestGoldenAssistMeetsGate(t *testing.T) {
	w := households.Golden()
	o := DefaultOptions()
	o.Away = w.Away()
	total, per := Replay(w.Events, o)
	if total.Added < 20 || total.Precision() < 0.85 || total.RemovalsPerWeek() > 1 {
		t.Fatalf("gate missed: adds %d precision %.3f removals/wk %.2f", total.Added, total.Precision(), total.RemovalsPerWeek())
	}
	// The weekend shopper is what assist is for: it should carry a real share of the shop.
	if r := per[w.House("weekend-couple").Room]; r.OpenRecall() < 0.3 {
		t.Errorf("weekend couple: open recall %.3f", r.OpenRecall())
	}
	// Irregular buyers and houses with too little history get nothing added.
	for _, p := range []string{"solo-irregular", "new-house"} {
		if r := per[w.House(p).Room]; r.Added != 0 {
			t.Errorf("%s: assist added %d", p, r.Added)
		}
	}
}

// F1 (precision x open recall) is ratcheted: it may only go up, toward F1Goal (70%). Raise the
// floor when a change lifts it; never lower it.
func TestGoldenAssistF1Floor(t *testing.T) {
	const floor = 0.52 // 2026-10-17: 52.6% at the default bar
	w := households.Golden()
	o := DefaultOptions()
	o.Away = w.Away()
	total, _ := Replay(w.Events, o)
	if total.F1() < floor {
		t.Fatalf("F1 %.3f fell below the floor %.2f (goal %.2f)", total.F1(), floor, F1Goal)
	}
}

// A stricter bar never adds more.
func TestSweepIsMonotone(t *testing.T) {
	w := households.Golden()
	o := DefaultOptions()
	o.Away = w.Away()
	reps := Sweep(w.Events, o, []float64{0.65, 0.75, 0.8}, []float64{0.7})
	for i := 1; i < len(reps); i++ {
		if reps[i].Added > reps[i-1].Added {
			t.Fatalf("score %.2f adds %d > score %.2f adds %d", reps[i].Policy.AssistMinScore, reps[i].Added, reps[i-1].Policy.AssistMinScore, reps[i-1].Added)
		}
	}
}
