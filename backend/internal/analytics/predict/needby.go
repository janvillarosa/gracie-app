package predict

import (
	"math"
	"time"
)

// NeedBy is the probability the next occurrence comes before t: a log-normal over the cadence,
// with its median at the rhythm (EWMADays) and its spread from the rhythm's CV, measured from the
// last occurrence on the forecast's own clock (home time for ClockHome, with away). It is 0
// without a forecast, a step at the due time for a perfectly regular rhythm, and never above 0.5
// for a forecast that is not Confident: thin history must not clear an assist bar.
func NeedBy(f Forecast, t time.Time, away Away) float64 {
	if f.EWMADays <= 0 || f.LastAt.IsZero() {
		return 0
	}
	if f.Clock != ClockHome {
		away = nil
	}
	elapsed := away.homeDays(f.LastAt, t)
	if elapsed <= 0 {
		return 0
	}
	var p float64
	if f.CV <= 0 {
		if elapsed >= f.EWMADays {
			p = 1
		}
	} else {
		sigma := math.Sqrt(math.Log1p(f.CV * f.CV)) // a log-normal whose CV is f.CV
		p = 0.5 * math.Erfc(-math.Log(elapsed/f.EWMADays)/(sigma*math.Sqrt2))
	}
	if !f.Confident(DefaultParams) {
		p = math.Min(p, 0.5)
	}
	return p
}
