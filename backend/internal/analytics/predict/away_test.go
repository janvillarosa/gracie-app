package predict

import (
	"testing"
	"time"
)

var a0 = time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)

func aday(n float64) time.Time { return a0.Add(time.Duration(n * 24 * float64(time.Hour))) }

func adays(n float64) time.Duration { return time.Duration(n * 24 * float64(time.Hour)) }

func TestHomeClockNoAwayIsIdentity(t *testing.T) {
	var a Away
	if got := a.HomeBetween(aday(0), aday(7)); got != adays(7) {
		t.Fatalf("HomeBetween = %v", got)
	}
	if got := a.AddHome(aday(0), adays(7)); !got.Equal(aday(7)) {
		t.Fatalf("AddHome = %v", got)
	}
	if got := a.AddHome(aday(7), -adays(2)); !got.Equal(aday(5)) {
		t.Fatalf("AddHome back = %v", got)
	}
	if a.Contains(aday(1)) {
		t.Fatal("nobody is away")
	}
	if got := a.HomeBetween(aday(7), aday(0)); got != -adays(7) {
		t.Fatalf("reversed HomeBetween = %v", got)
	}
}

func TestNormalizeSortsMergesAndDropsEmpty(t *testing.T) {
	a := Away{{aday(10), aday(12)}, {aday(1), aday(3)}, {aday(2), aday(5)}, {aday(6), aday(6)}, {aday(9), aday(8)}, {aday(5), aday(6)}}.Normalize()
	want := Away{{aday(1), aday(6)}, {aday(10), aday(12)}}
	if len(a) != len(want) {
		t.Fatalf("got %v", a)
	}
	for i := range a {
		if !a[i].Opens.Equal(want[i].Opens) || !a[i].Closes.Equal(want[i].Closes) {
			t.Fatalf("got %v, want %v", a, want)
		}
	}
}

func TestHomeBetweenSubtractsAwaySpans(t *testing.T) {
	one := Away{{aday(2), aday(7)}}
	if got := one.HomeBetween(aday(0), aday(10)); got != adays(5) {
		t.Fatalf("one span: %v", got)
	}
	two := Away{{aday(2), aday(4)}, {aday(6), aday(7)}}
	if got := two.HomeBetween(aday(0), aday(10)); got != adays(7) {
		t.Fatalf("two spans: %v", got)
	}
	// a span covering `from` counts only its part after from
	cover := Away{{aday(-3), aday(2)}}
	if got := cover.HomeBetween(aday(0), aday(10)); got != adays(8) {
		t.Fatalf("covering from: %v", got)
	}
	// and one covering `to` only its part before to
	if got := (Away{{aday(8), aday(20)}}).HomeBetween(aday(0), aday(10)); got != adays(8) {
		t.Fatalf("covering to: %v", got)
	}
}

func TestAddHomeSkipsAwaySpans(t *testing.T) {
	// a 7-day rhythm with a 5-day trip in the middle is due 12 days later
	a := Away{{aday(3), aday(8)}}
	if got := a.AddHome(aday(0), adays(7)); !got.Equal(aday(12)) {
		t.Fatalf("AddHome across = %v", got)
	}
	// landing inside a span jumps to its end
	if got := a.AddHome(aday(0), adays(3)+time.Hour); !got.Equal(aday(8).Add(time.Hour)) {
		t.Fatalf("AddHome into = %v", got)
	}
	if got := a.AddHome(aday(4), 0); !got.Equal(aday(8)) {
		t.Fatalf("AddHome from inside = %v", got)
	}
	// backwards skips the span too
	if got := a.AddHome(aday(10), -adays(4)); !got.Equal(aday(1)) {
		t.Fatalf("AddHome back = %v", got)
	}
	if !a.Contains(aday(3)) || a.Contains(aday(8)) || a.Contains(aday(2)) {
		t.Fatal("spans are [opens, closes)")
	}
}

func TestHomeBetweenAndAddHomeAgree(t *testing.T) {
	a := Away{{aday(2), aday(4)}, {aday(6), aday(9)}, {aday(15), aday(16)}}
	for _, d := range []float64{0.5, 2, 3, 7, 11} {
		end := a.AddHome(aday(0), adays(d))
		if got := a.HomeBetween(aday(0), end); got != adays(d) {
			t.Fatalf("d=%v: end=%v home=%v", d, end, got)
		}
	}
}
