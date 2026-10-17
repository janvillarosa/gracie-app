package predict

import (
	"slices"
	"strings"
)

// MaxTurns is how many recent completers a key remembers.
const MaxTurns = 8

// NextTurn guesses whose turn it is to do something, from who did it (turns, newest first) and
// the house's current members. Strict alternation wins when the last four completions alternate
// between two current members; otherwise it is the member with the fewest of the last eight
// completions (ties: the one who did it longest ago, never counts as longest). It returns ""
// when unsure: no history, or fewer than two members. system:* actors and people who have left
// are ignored.
func NextTurn(turns []string, members []string) string {
	if len(members) < 2 {
		return ""
	}
	var real []string
	for _, t := range turns {
		if t != "" && !strings.HasPrefix(t, "system:") {
			real = append(real, t)
		}
	}
	if len(real) == 0 {
		return ""
	}
	if len(real) > MaxTurns {
		real = real[:MaxTurns]
	}
	if len(real) >= 4 {
		a, b := real[0], real[1]
		if a != b && real[2] == a && real[3] == b && slices.Contains(members, a) && slices.Contains(members, b) {
			return b
		}
	}
	best, bestCount, bestAgo := "", 0, 0
	for _, m := range members {
		count, ago := 0, len(real) // never in the window: longest ago
		for i, t := range real {
			if t == m {
				if count == 0 {
					ago = i
				}
				count++
			}
		}
		if best == "" || count < bestCount || (count == bestCount && ago > bestAgo) {
			best, bestCount, bestAgo = m, count, ago
		}
	}
	return best
}
