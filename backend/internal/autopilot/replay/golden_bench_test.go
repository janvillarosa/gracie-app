package replay

import (
	"fmt"
	"os"
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/testutil/households"
)

// TestPrintGoldenBenchmark prints the golden-household benchmark when AUTOPILOT_BENCH=1.
func TestPrintGoldenBenchmark(t *testing.T) {
	if os.Getenv("AUTOPILOT_BENCH") == "" {
		t.Skip("set AUTOPILOT_BENCH=1")
	}
	w := households.Golden()
	o := DefaultOptions()
	o.Away = w.Away()
	total, per := Replay(w.Events, o)
	fmt.Printf("total: runs %d adds %d hits %d later %d precision %.3f recall %.3f staple-recall %.3f open-recall %.3f removals/wk %.2f adds/run %.2f\n",
		total.Runs, total.Added, total.Hits, total.Later, total.Precision(), total.Recall(), total.StapleRecall(), total.OpenRecall(), total.RemovalsPerWeek(), total.AddsPerRun())
	for _, h := range w.Houses {
		r := per[h.Room]
		fmt.Printf("  %-20s runs %3d adds %3d hits %3d precision %.3f open-recall %.3f (%d open) removals/wk %.2f\n", h.Persona, r.Runs, r.Added, r.Hits, r.Precision(), r.OpenRecall(), r.Open, r.RemovalsPerWeek())
	}
	for _, r := range Sweep(w.Events, o, []float64{0.65, 0.7, 0.75, 0.8, 0.85, 0.9}, []float64{0.5, 0.6, 0.7, 0.8, 0.9}) {
		fmt.Printf("  score>=%.2f need>=%.2f  adds %4d precision %.3f open-recall %.3f removals/wk %.2f\n", r.Policy.AssistMinScore, r.Policy.AssistMinNeed, r.Added, r.Precision(), r.OpenRecall(), r.RemovalsPerWeek())
	}
}
