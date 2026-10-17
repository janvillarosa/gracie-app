package predict

import (
	"sort"
	"time"
)

// Away is when a house (or one person) is away: sorted, non-overlapping spans, each
// [Opens, Closes). Away time is not time for a rhythm: a gap between two buys is measured in
// home time (wall-clock time minus the overlap with these spans), and due dates are projected in
// home time too. A nil Away is "never away", and every method is then plain wall-clock arithmetic.
//
// The methods assume a normalized slice (see Normalize); they are O(n) in the number of spans.
type Away []Span

// Normalize returns the spans sorted, with empty ones dropped and overlapping or touching ones
// merged. It does not modify a.
func (a Away) Normalize() Away {
	if len(a) == 0 {
		return nil
	}
	s := make(Away, 0, len(a))
	for _, sp := range a {
		if sp.Closes.After(sp.Opens) {
			s = append(s, sp)
		}
	}
	sort.Slice(s, func(i, j int) bool { return s[i].Opens.Before(s[j].Opens) })
	out := s[:0]
	for _, sp := range s {
		if n := len(out); n > 0 && !sp.Opens.After(out[n-1].Closes) {
			if sp.Closes.After(out[n-1].Closes) {
				out[n-1].Closes = sp.Closes
			}
			continue
		}
		out = append(out, sp)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// Contains reports whether t falls inside an away span.
func (a Away) Contains(t time.Time) bool {
	for _, sp := range a {
		if t.Before(sp.Opens) {
			return false
		}
		if t.Before(sp.Closes) {
			return true
		}
	}
	return false
}

// NextHome is the first home moment at or after t: t itself, or the end of the away span it is in.
func (a Away) NextHome(t time.Time) time.Time {
	for _, sp := range a {
		if t.Before(sp.Opens) {
			return t
		}
		if t.Before(sp.Closes) {
			return sp.Closes
		}
	}
	return t
}

// homeDays is the home time between two moments, in days.
func (a Away) homeDays(from, to time.Time) float64 {
	if a == nil {
		return to.Sub(from).Hours() / 24
	}
	return a.HomeBetween(from, to).Hours() / 24
}

// addDays moves t by a number of days of home time.
func (a Away) addDays(t time.Time, days float64) time.Time {
	d := time.Duration(days * 24 * float64(time.Hour))
	if a == nil {
		return t.Add(d)
	}
	return a.AddHome(t, d)
}

// HomeBetween is the home time from `from` to `to`: the wall-clock duration minus the part spent
// away. Negative when to is before from.
func (a Away) HomeBetween(from, to time.Time) time.Duration {
	if to.Before(from) {
		return -a.HomeBetween(to, from)
	}
	d := to.Sub(from)
	for _, sp := range a {
		if !sp.Opens.Before(to) {
			break
		}
		lo, hi := sp.Opens, sp.Closes
		if lo.Before(from) {
			lo = from
		}
		if hi.After(to) {
			hi = to
		}
		if hi.After(lo) {
			d -= hi.Sub(lo)
		}
	}
	return d
}

// AddHome moves t by d of home time: forwards, every away span on the way is skipped, and a start
// or an end inside one moves to the span's end (nothing is expected while the house is away).
// Backwards (d < 0), spans are skipped the same way towards the past.
func (a Away) AddHome(t time.Time, d time.Duration) time.Time {
	if d < 0 {
		return a.subHome(t, -d)
	}
	cur := t
	for _, sp := range a {
		if !sp.Closes.After(cur) {
			continue // behind us
		}
		if sp.Opens.After(cur) {
			if gap := sp.Opens.Sub(cur); d < gap {
				return cur.Add(d)
			} else {
				d -= gap
			}
		}
		cur = sp.Closes // inside the span, or reached it: home time resumes at its end
	}
	return cur.Add(d)
}

func (a Away) subHome(t time.Time, d time.Duration) time.Time {
	cur := t
	for i := len(a) - 1; i >= 0; i-- {
		sp := a[i]
		if !sp.Opens.Before(cur) {
			continue // ahead of us
		}
		if sp.Closes.Before(cur) {
			if gap := cur.Sub(sp.Closes); d <= gap {
				return cur.Add(-d)
			} else {
				d -= gap
			}
		}
		cur = sp.Opens
	}
	return cur.Add(-d)
}
