package places

import (
	"log"
	"sync"

	"github.com/ringsaturn/tzf"
)

// TZResolver maps coordinates to an IANA zone using an embedded offline dataset.
type TZResolver interface{ TZ(lat, lng float64) string }

type tzfResolver struct{ f tzf.F }

func (r tzfResolver) TZ(lat, lng float64) string { return r.f.GetTimezoneName(lng, lat) }

// NewTZF loads the embedded timezone finder. Measure its RAM and binary-size cost in the build log.
func NewTZF() (TZResolver, error) {
	f, err := tzf.NewDefaultFinder()
	if err != nil {
		return nil, err
	}
	return tzfResolver{f: f}, nil
}

// lazyTZ defers loading the finder (~34 MB heap, ~150 ms) until the first lookup.
type lazyTZ struct {
	once sync.Once
	load func() (TZResolver, error)
	r    TZResolver
}

// NewLazyTZF returns a resolver that loads the embedded dataset on first use. A load
// failure is logged once and every lookup then returns "" (the client keeps its own zone).
func NewLazyTZF() TZResolver { return &lazyTZ{load: NewTZF} }

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
