package replay

import (
	"fmt"
	"os"
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/testutil/households"
)

func TestPrintWideSweep(t *testing.T) {
	if os.Getenv("AUTOPILOT_BENCH") == "" {
		t.Skip("set AUTOPILOT_BENCH=1")
	}
	w := households.Golden()
	o := DefaultOptions()
	o.Away = w.Away()
	for _, r := range Sweep(w.Events, o, []float64{0.2, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65}, []float64{0.5, 0.6, 0.7, 0.8}) {
		fmt.Printf("score>=%.2f need>=%.2f adds %3d P %.3f R %.3f F1 %.3f rem/wk %.2f\n", r.Policy.AssistMinScore, r.Policy.AssistMinNeed, r.Added, r.Precision(), r.OpenRecall(), r.F1(), r.RemovalsPerWeek())
	}
}

func TestPrintMissesAt(t *testing.T) {
	if os.Getenv("AUTOPILOT_BENCH") == "" {
		t.Skip("set AUTOPILOT_BENCH=1")
	}
	w := households.Golden()
	o := DefaultOptions()
	o.Away = w.Away()
	Debug = func(l string) { fmt.Println("  miss:", l) }
	total, _ := Replay(w.Events, o)
	Debug = nil
	fmt.Printf("F1 %.3f P %.3f R %.3f misses %v\n", total.F1(), total.Precision(), total.OpenRecall(), total.Misses)
}

// Hold-out: the bar tuned on the golden seed, replayed on households from other seeds.
func TestPrintHoldOut(t *testing.T) {
	if os.Getenv("AUTOPILOT_BENCH") == "" {
		t.Skip("set AUTOPILOT_BENCH=1")
	}
	for _, seed := range []int64{1, 7, 42, 2025, 99991} {
		w := households.Generate(seed)
		o := DefaultOptions()
		o.Away = w.Away()
		r, _ := Replay(w.Events, o)
		fmt.Printf("seed %6d runs %3d adds %3d P %.3f R %.3f F1 %.3f rem/wk %.2f\n", seed, r.Runs, r.Added, r.Precision(), r.OpenRecall(), r.F1(), r.RemovalsPerWeek())
	}
}
