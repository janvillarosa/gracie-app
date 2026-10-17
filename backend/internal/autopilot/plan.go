package autopilot

import (
	"math"
	"sort"
	"unicode"
	"unicode/utf8"
)

// Plan turns a snapshot's open candidates into restock proposals: the usual wording and quantity,
// the reason, and the cycle that makes it one action per thing per cycle. It is pure.
func Plan(s Snapshot, p Policy) []Proposal {
	if s.Paused || s.NoRun || s.Away || s.NotYet {
		return nil
	}
	out := make([]Proposal, 0, len(s.Open))
	for _, r := range s.Open {
		every := max(1, int(math.Round(r.EveryDays)))
		pr := Proposal{
			Kind: KindRestock, Basis: r.Basis, ListID: s.ListID, Key: r.Key, Display: capitalizeFirst(r.Key), Category: r.Category,
			Confidence: r.Score, Need: r.NeedBy, EveryDays: every, DueInDays: r.DueInDays,
			Reason: Reason{Code: ReasonEveryDays, Params: map[string]any{"days": every}},
			Cycle:  r.LastAt.UTC().Format("2006-01-02"), Effect: EffectAddToList,
			Series: r.Series, LastAt: r.LastAt, OpensAt: r.OpensAt, ClosesAt: r.ClosesAt,
		}
		if s.Run != nil {
			pr.RunAt = s.Run.Next.Start
		}
		if u, ok := s.Usual[r.Key]; ok {
			pr.Display, pr.Quantity, pr.Unit = u.Display, u.Quantity, u.Unit
			if u.Category != "" {
				pr.Category = u.Category
			}
		}
		out = append(out, pr)
	}
	if s.Horizon == HorizonRunAfterNext {
		sort.SliceStable(out, func(i, j int) bool {
			if out[i].Need != out[j].Need {
				return out[i].Need > out[j].Need
			}
			return out[i].Confidence > out[j].Confidence
		})
		if p.MaxPerRun > 0 && len(out) > p.MaxPerRun {
			out = out[:p.MaxPerRun]
		}
		return out
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].DueInDays != out[j].DueInDays {
			return out[i].DueInDays < out[j].DueInDays
		}
		return out[i].Confidence > out[j].Confidence
	})
	return out
}

func capitalizeFirst(s string) string {
	if s == "" {
		return s
	}
	r, n := utf8.DecodeRuneInString(s)
	return string(unicode.ToUpper(r)) + s[n:]
}
