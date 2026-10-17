package trips

import (
	"slices"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

// Presence: who is away when, from a house's trips. A trip with no travellers is the whole
// house. A traveller is away from start_date 00:00 to end_date 24:00 in the trip's zone (the
// house's when the trip has none). Soft-deleted trips, trips without both dates and travellers who
// are no longer members are ignored. The result feeds analytics through its AwayCalendar port.

const dateLayout = "2006-01-02"

// awaySpan is the trip's away span, or false when the trip does not count.
func awaySpan(t models.Trip, houseTZ string) (predict.Span, bool) {
	if t.DeletedAt != nil || t.StartDate == nil || t.EndDate == nil {
		return predict.Span{}, false
	}
	zone := t.TZ
	if zone == "" {
		zone = houseTZ
	}
	loc, err := time.LoadLocation(zone)
	if err != nil || zone == "" {
		loc = time.UTC
	}
	start, err1 := time.ParseInLocation(dateLayout, *t.StartDate, loc)
	end, err2 := time.ParseInLocation(dateLayout, *t.EndDate, loc)
	if err1 != nil || err2 != nil || end.Before(start) {
		return predict.Span{}, false
	}
	return predict.Span{Opens: start.UTC(), Closes: end.AddDate(0, 0, 1).UTC()}, true
}

// goes reports whether member is on the trip.
func goes(t models.Trip, member string) bool {
	return len(t.Travellers) == 0 || slices.Contains(t.Travellers, member)
}

// MemberAway is when one person is away on the house's trips.
func MemberAway(trips []models.Trip, member string, houseTZ string) predict.Away {
	var out predict.Away
	for _, t := range trips {
		if !goes(t, member) {
			continue
		}
		if s, ok := awaySpan(t, houseTZ); ok {
			out = append(out, s)
		}
	}
	return out.Normalize()
}

// HouseAway is when the whole house is away: every current member at once. A house with no
// members is never away.
func HouseAway(trips []models.Trip, members []string, houseTZ string) predict.Away {
	if len(members) == 0 {
		return nil
	}
	away := MemberAway(trips, members[0], houseTZ)
	for _, m := range members[1:] {
		if len(away) == 0 {
			return nil
		}
		away = intersect(away, MemberAway(trips, m, houseTZ))
	}
	return away
}

// intersect is the time both normalized span lists cover.
func intersect(a, b predict.Away) predict.Away {
	var out predict.Away
	i, j := 0, 0
	for i < len(a) && j < len(b) {
		lo, hi := a[i].Opens, a[i].Closes
		if b[j].Opens.After(lo) {
			lo = b[j].Opens
		}
		if b[j].Closes.Before(hi) {
			hi = b[j].Closes
		}
		if hi.After(lo) {
			out = append(out, predict.Span{Opens: lo, Closes: hi})
		}
		if a[i].Closes.Before(b[j].Closes) {
			i++
		} else {
			j++
		}
	}
	return out
}
