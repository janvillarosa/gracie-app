package parse

import "strings"

// SimilarThreshold is how alike two item names must be to be treated as the same thing for
// smart suggestions ("orange" and "oranges", "butterbeans" and "butter beans").
const SimilarThreshold = 0.85

// minFuzzyLen keeps short names exact: "tea" and "pea" differ by one letter but are not alike.
const minFuzzyLen = 4

// CompactKey folds the differences that don't change what a thing is: spaces and hyphens, and
// simple English plurals ("berries" -> "berry", "peaches" -> "peach", "oranges" -> "orange").
// It expects a normalized key (see NormalizeKey).
func CompactKey(key string) string {
	var b strings.Builder
	for _, w := range strings.FieldsFunc(key, func(r rune) bool { return r == ' ' || r == '-' }) {
		b.WriteString(singular(w))
	}
	return b.String()
}

func singular(w string) string {
	if len(w) <= 3 {
		return w
	}
	switch {
	case strings.HasSuffix(w, "ies") && len(w) > 4:
		return w[:len(w)-3] + "y"
	case strings.HasSuffix(w, "sses"), strings.HasSuffix(w, "ches"), strings.HasSuffix(w, "shes"),
		strings.HasSuffix(w, "xes"), strings.HasSuffix(w, "zes"), strings.HasSuffix(w, "oes"):
		return w[:len(w)-2]
	case strings.HasSuffix(w, "s") && !strings.HasSuffix(w, "ss") && !strings.HasSuffix(w, "us") && !strings.HasSuffix(w, "is"):
		return w[:len(w)-1]
	}
	return w
}

// Similarity is 1 for names that are the same thing once plurals and spacing are folded, and
// otherwise one minus the edit distance over the longer length. Names under four letters only
// match exactly.
func Similarity(a, b string) float64 {
	ca, cb := CompactKey(a), CompactKey(b)
	if ca == cb {
		return 1
	}
	ra, rb := []rune(ca), []rune(cb)
	longer := max(len(ra), len(rb))
	if min(len(ra), len(rb)) < minFuzzyLen || longer == 0 {
		return 0
	}
	return 1 - float64(levenshtein(ra, rb))/float64(longer)
}

// Similar reports whether two names are alike enough to share a suggestion history.
func Similar(a, b string) bool { return Similarity(a, b) >= SimilarThreshold }

func levenshtein(a, b []rune) int {
	prev := make([]int, len(b)+1)
	cur := make([]int, len(b)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(a); i++ {
		cur[0] = i
		for j := 1; j <= len(b); j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost)
		}
		prev, cur = cur, prev
	}
	return prev[len(b)]
}
