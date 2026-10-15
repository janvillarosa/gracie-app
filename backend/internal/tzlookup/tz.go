// Package tzlookup derives IANA time zones from coordinates with an embedded offline dataset.
package tzlookup

import (
	"log"
	"sync"

	"github.com/ringsaturn/tzf"
)

// Resolver maps coordinates to an IANA zone using an embedded offline dataset.
type Resolver interface{ TZ(lat, lng float64) string }

type tzfResolver struct{ f tzf.F }

func (r tzfResolver) TZ(lat, lng float64) string { return r.f.GetTimezoneName(lng, lat) }

// NewFinder loads the embedded timezone finder (~34 MB heap, ~150 ms).
func NewFinder() (Resolver, error) {
	f, err := tzf.NewDefaultFinder()
	if err != nil {
		return nil, err
	}
	return tzfResolver{f: f}, nil
}

// lazyTZ defers loading the finder (~34 MB heap, ~150 ms) until the first lookup.
type lazyTZ struct {
	once sync.Once
	load func() (Resolver, error)
	r    Resolver
}

// NewLazy returns a resolver that loads the embedded dataset on first use. A load
// failure is logged once and every lookup then returns "" (the client keeps its own zone).
func NewLazy() Resolver { return &lazyTZ{load: NewFinder} }

func (l *lazyTZ) TZ(lat, lng float64) string {
	l.once.Do(func() {
		r, err := l.load()
		if err != nil {
			log.Printf("places: timezone finder unavailable: %v", err)
			return
		}
		l.r = r
	})
	if l.r == nil {
		return ""
	}
	return l.r.TZ(lat, lng)
}
