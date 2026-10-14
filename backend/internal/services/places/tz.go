package places

import "github.com/ringsaturn/tzf"

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
