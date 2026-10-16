package main

import (
	"io"
	"strings"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
)

func TestParseArgs(t *testing.T) {
	tests := []struct {
		name    string
		args    []string
		want    options
		wantErr string
	}{
		{"default is a dry run", nil, options{}, ""},
		{"apply with fold and room", []string{"--apply", "--fold", "--room", "room_1"}, options{Apply: true, Fold: true, RoomID: "room_1"}, ""},
		{"before is parsed as UTC", []string{"--before", "2026-10-16T12:00:00+02:00"}, options{Before: time.Date(2026, 10, 16, 10, 0, 0, 0, time.UTC)}, ""},
		{"fold without apply is refused", []string{"--fold"}, options{}, "--fold needs --apply"},
		{"bad time", []string{"--before", "yesterday"}, options{}, "--before"},
		{"stray argument", []string{"room_1"}, options{}, "unexpected arguments"},
		{"unknown flag", []string{"--dry-run"}, options{}, "flag provided but not defined"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseArgs(tc.args, io.Discard)
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("err = %v, want containing %q", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got.Apply != tc.want.Apply || got.Fold != tc.want.Fold || got.RoomID != tc.want.RoomID || !got.Before.Equal(tc.want.Before) {
				t.Fatalf("got %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestSummaryStatesWhetherAnythingWasWritten(t *testing.T) {
	rep := &analytics.BackfillReport{Cutoff: time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC), ByName: map[string]int{"item.added": 3}, BySource: map[string]int{"items": 3}, Skipped: map[string]int{"live_marker": 1}, Emitted: 3}
	if s := summary(rep); !strings.Contains(s, "DRY RUN") || !strings.Contains(s, "item.added=3") || !strings.Contains(s, "live_marker=1") {
		t.Fatalf("dry-run summary:\n%s", s)
	}
	rep.Applied, rep.Inserted = true, 3
	if s := summary(rep); strings.Contains(s, "DRY RUN") || !strings.Contains(s, "APPLIED") || !strings.Contains(s, "inserted: 3") {
		t.Fatalf("applied summary:\n%s", s)
	}
}
