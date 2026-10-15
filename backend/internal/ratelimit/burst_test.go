package ratelimit

import "testing"

func TestBurstNeverBelowOne(t *testing.T) {
	for rps, want := range map[float64]int{0.1: 1, 0.25: 1, 0.3: 2, 1: 4, 2: 8, 5: 20, 0: 1} {
		if got := Burst(rps); got != want {
			t.Errorf("Burst(%v)=%d want %d", rps, got, want)
		}
	}
	l := New(0.1, Burst(0.1))
	if !l.Allow("k") {
		t.Fatalf("a sub-1 rps limiter must still admit a first request")
	}
}
