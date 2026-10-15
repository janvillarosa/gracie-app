package tzlookup

import (
	"errors"
	"sync/atomic"
	"testing"
)

type fixedTZ struct{}

func (fixedTZ) TZ(lat, lng float64) string { return "Asia/Tokyo" }

func TestLazyLoadsOnceAndOnlyOnFirstUse(t *testing.T) {
	var loads int32
	l := &lazyTZ{load: func() (Resolver, error) { atomic.AddInt32(&loads, 1); return fixedTZ{}, nil }}
	if atomic.LoadInt32(&loads) != 0 {
		t.Fatalf("loaded eagerly")
	}
	for i := 0; i < 3; i++ {
		if got := l.TZ(1, 2); got != "Asia/Tokyo" {
			t.Fatalf("tz=%q", got)
		}
	}
	if atomic.LoadInt32(&loads) != 1 {
		t.Fatalf("loads=%d", loads)
	}
}

func TestLazyLoadFailureDegradesToEmpty(t *testing.T) {
	var loads int32
	l := &lazyTZ{load: func() (Resolver, error) { atomic.AddInt32(&loads, 1); return nil, errors.New("no data") }}
	if l.TZ(1, 2) != "" || l.TZ(3, 4) != "" || atomic.LoadInt32(&loads) != 1 {
		t.Fatalf("failure should yield empty tz and not retry; loads=%d", loads)
	}
}

func TestRealFinderResolves(t *testing.T) {
	if got := NewLazy().TZ(35.0, 135.7); got != "Asia/Tokyo" {
		t.Fatalf("tz=%q", got)
	}
}
