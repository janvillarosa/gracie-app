package trips

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

var testTripID = "trip_" + strings.Repeat("a", 32)

func rawOp(t *testing.T, m map[string]any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func goodOp() map[string]any {
	return map[string]any{"v": 1, "op_id": "op-1", "client_id": "dev-a", "seq": 1, "at": 1700000000000,
		"type": "trip.create", "trip_id": testTripID, "patch": map[string]any{"title": "Japan"}}
}

func TestDecodeOpAccepts(t *testing.T) {
	op, _, ok := DecodeOp(rawOp(t, goodOp()))
	if !ok || op.Type != TypeTripCreate || op.Seq != 1 {
		t.Fatalf("expected a valid op, got ok=%v op=%+v", ok, op)
	}
}

func TestDecodeOpRejections(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(m map[string]any)
		code   string
	}{
		{"unknown op field", func(m map[string]any) { m["extra"] = 1 }, models.CodeUnsupported},
		{"unknown version", func(m map[string]any) { m["v"] = 2 }, models.CodeUnsupported},
		{"unknown type", func(m map[string]any) { m["type"] = "trip.explode" }, models.CodeUnsupported},
		{"bad trip id", func(m map[string]any) { m["trip_id"] = "trip_nothex" }, models.CodeInvalid},
		{"dotted client id", func(m map[string]any) { m["client_id"] = "a.b" }, models.CodeInvalid},
		{"zero seq", func(m map[string]any) { m["seq"] = 0 }, models.CodeInvalid},
		{"todo op without entity", func(m map[string]any) { m["type"] = "todo.create" }, models.CodeInvalid},
		{"trip op with entity", func(m map[string]any) { m["entity_id"] = "ttd_" + strings.Repeat("1", 32) }, models.CodeInvalid},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := goodOp()
			tc.mutate(m)
			_, res, ok := DecodeOp(rawOp(t, m))
			if ok || res.Status != models.OpRejected || res.Code != tc.code || res.OpID != "op-1" {
				t.Fatalf("want rejected/%s with op_id, got ok=%v res=%+v", tc.code, ok, res)
			}
		})
	}
}

func TestOptDistinguishesAbsentNullAndValue(t *testing.T) {
	var p TodoPatch
	if code := decodePatch(json.RawMessage(`{"day":null,"start_time":"09:30"}`), &p); code != "" {
		t.Fatalf("decode: %s", code)
	}
	if !p.Day.Set || p.Day.Val != nil {
		t.Fatalf("null day should be Set with nil Val: %+v", p.Day)
	}
	if !p.StartTime.Set || p.StartTime.Val == nil || *p.StartTime.Val != "09:30" {
		t.Fatalf("start_time: %+v", p.StartTime)
	}
	if p.Place.Set {
		t.Fatalf("absent place must not be Set")
	}
}

func TestDecodePatchUnknownFieldIsUnsupported(t *testing.T) {
	var p TripPatch
	if code := decodePatch(json.RawMessage(`{"room_id":"x"}`), &p); code != models.CodeUnsupported {
		t.Fatalf("got %q", code)
	}
	if code := decodePatch(json.RawMessage(`{"title":5}`), &p); code != models.CodeInvalid {
		t.Fatalf("wrong type should be invalid, got %q", code)
	}
}

func TestValidators(t *testing.T) {
	s := func(v string) *string { return &v }
	if validTripPatch(TripPatch{}, true) {
		t.Fatal("create needs a title")
	}
	if !validTripPatch(TripPatch{Title: s("Kyoto")}, true) {
		t.Fatal("plain title should be valid")
	}
	if validTripPatch(TripPatch{Title: s("   ")}, true) {
		t.Fatal("blank title invalid")
	}
	if validTripPatch(TripPatch{TZ: s("Mars/Olympus")}, false) {
		t.Fatal("bad tz invalid")
	}
	if validTodoPatch(TodoPatch{Title: s("x"), Category: s("nope")}, true) {
		t.Fatal("bad category invalid")
	}
	if validTodoPatch(TodoPatch{Title: s("x"), StartTime: Opt[string]{Set: true, Val: s("25:99")}}, true) {
		t.Fatal("bad clock invalid")
	}
	if validTodoPatch(TodoPatch{Title: s("x"), Day: Opt[string]{Set: true, Val: s("2026-02-30")}}, true) {
		t.Fatal("impossible date invalid")
	}
	if validBookingPatch(BookingPatch{Title: s("Flight")}, true) {
		t.Fatal("booking create needs kind")
	}
	if !validBookingPatch(BookingPatch{Kind: s("flight"), Title: s("NH 105"),
		StartsAt: Opt[string]{Set: true, Val: s("2026-11-01T09:30")}, StartTZ: Opt[string]{Set: true, Val: s("Asia/Tokyo")}}, true) {
		t.Fatal("valid booking rejected")
	}
}
