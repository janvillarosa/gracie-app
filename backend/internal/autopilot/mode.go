// Package autopilot decides what Bauhouse does on a house's behalf. It is pure: the mode rules,
// the planner and the policy live here, and services do every read and write. It imports
// analytics' pure prediction code; analytics never imports it.
package autopilot

import "strings"

// Mode is how much the autopilot may do for a house. Full autopilot (buying, booking or messaging
// for someone) is deliberately not a mode: anything outside Bauhouse needs a new mode and the
// house's explicit consent.
type Mode string

const (
	// ModeOff proposes and does nothing.
	ModeOff Mode = "off"
	// ModeSuggest only proposes: slips a person taps to accept. Nothing changes until someone acts.
	ModeSuggest Mode = "suggest"
	// ModeAssist applies in-app, reversible actions by itself (each marked, with a reason and
	// Undo), and falls back to suggesting what it is less sure about.
	ModeAssist Mode = "assist"
)

// ParseMode reads a mode, ignoring case and spaces. ok is false for anything unknown.
func ParseMode(s string) (Mode, bool) {
	switch m := Mode(strings.ToLower(strings.TrimSpace(s))); m {
	case ModeOff, ModeSuggest, ModeAssist:
		return m, true
	}
	return "", false
}

// HouseMode reads a house's stored setting. Nothing stored is suggest (today's suggestions), and
// a house that switched suggestions off before modes existed (legacyOff) reads as off, so no
// data migration is needed.
func HouseMode(stored string, legacyOff bool) Mode {
	if m, ok := ParseMode(stored); ok {
		return m
	}
	if legacyOff {
		return ModeOff
	}
	return ModeSuggest
}
