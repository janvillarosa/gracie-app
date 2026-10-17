// Package households is the golden dataset for analytics: a seeded, deterministic year of
// made-up households whose behavior is drawn from how real houses use Bauhouse. Every analytics
// test that needs "a realistic house" should use it, and cmd/suggest-eval -synthetic replays it.
//
// Each house is a persona that exercises a case the engine must handle:
//
//	weekend-couple       Saturday-morning shoppers who skip some weeks; a 2-week summer holiday,
//	                     a long weekend away and a solo trip (the house is still home); Europe/London
//	bin-day              chores that follow the calendar: bin bags every other Tuesday ~20:00 taken
//	                     out in strict turns, recycling every Tuesday by whoever; check-only items
//	                     (unchecked, then checked again), never re-added; America/New_York
//	solo-irregular       one person topping up at random: nothing here is regular enough to suggest
//	habit-changer        milk goes from weekly to every 4 days, coffee from fortnightly to weekly
//	lookalikes           "yogurt"/"yoghurt" and "tomato"/"tomatoes" for one thing; suggestions are
//	                     taken, ignored, and ignored mid-shop (run mode)
//	frequent-travellers  away most months; trips in another zone (Asia/Tokyo), a deleted trip, a
//	                     dateless trip, a trip with a member who has since left; Australia/Sydney
//	new-house            joined three weeks before the end: too little history for anything
//	bursty               taps twice: double adds and check/uncheck/check within minutes
//	big-family           four people (one joins mid-year), two lists, high volume; Asia/Manila
//	monthly-stocker      one big shop a month
//
// Consumables are used up at home: their next need comes a rhythm of home time after the last
// buy (nobody eats the milk while away). Calendar items (bins) keep the wall calendar and are just
// skipped while away. Both kinds are needed for an honest eval of home time.
package households

import (
	"context"
	"fmt"
	"math"
	"math/rand"
	"sort"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/trips"
)

// Seed is the golden seed. Changing it (or the generator) changes every golden file.
const Seed = 20261017

// End is the moment the dataset stops; it starts a year earlier.
var End = time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)

// Kind says what a key is expected to look like to the engine.
type Kind string

const (
	Staple    Kind = "staple"    // a regular consumable: should become a confident suggestion
	Irregular Kind = "irregular" // bought at random: must never be suggested
	Thin      Kind = "thin"      // too little history: must never be suggested
	Calendar  Kind = "calendar"  // follows the calendar (Weekly says how)
	OneOff    Kind = "one-off"   // bought once
)

// Expect is what a test may assert about one key of a house.
type Expect struct {
	Key  string
	Kind Kind
	// Calendar keys: every N weeks on a local weekday at an hour.
	EveryWeeks, Weekday, Hour int
	// Turns: the members who take turns completing it, in strict alternation ("" when not).
	Turns []string
}

// House is one household.
type House struct {
	Room    string
	Persona string
	TZ      string
	Members []string // current members, in join order
	Left    []string // people who were members and left
	Trips   []models.Trip
	Expect  []Expect
}

// Away is when the whole house was away (as services.AwayCalendar computes it).
func (h House) Away() predict.Away { return trips.HouseAway(h.Trips, h.Members, h.TZ) }

// World is the whole dataset.
type World struct {
	Houses []House
	Events []analytics.Event // ascending by OccurredAt, deterministic ids, ingested a minute after
}

// Away maps each room to its house-away spans.
func (w World) Away() map[string]predict.Away {
	out := map[string]predict.Away{}
	for _, h := range w.Houses {
		out[h.Room] = h.Away()
	}
	return out
}

// Calendar is an analytics.AwayCalendar over the world's trips, like services.AwayCalendar.
func (w World) Calendar() analytics.AwayCalendar { return calendar{w} }

type calendar struct{ w World }

func (c calendar) HouseAway(_ context.Context, roomID string) (predict.Away, error) {
	for _, h := range c.w.Houses {
		if h.Room == roomID {
			return h.Away(), nil
		}
	}
	return nil, nil
}

func (c calendar) MemberAway(_ context.Context, roomID, userID string) (predict.Away, error) {
	for _, h := range c.w.Houses {
		if h.Room == roomID {
			return trips.MemberAway(h.Trips, userID, h.TZ), nil
		}
	}
	return nil, nil
}

// House returns the house with a persona name.
func (w World) House(persona string) House {
	for _, h := range w.Houses {
		if h.Persona == persona {
			return h
		}
	}
	panic("households: no persona " + persona)
}

// Generate builds the world for a seed. The same seed always gives the same world.
func Generate(seed int64) World {
	var w World
	for i, persona := range personas {
		g := &gen{rng: rand.New(rand.NewSource(seed + int64(i)*7919)), start: End.AddDate(-1, 0, 0)}
		g.h = &House{Room: fmt.Sprintf("room_%s", persona.name), Persona: persona.name}
		persona.build(g)
		g.events = trim(g.events)
		w.Houses = append(w.Houses, *g.h)
		w.Events = append(w.Events, g.events...)
	}
	sort.SliceStable(w.Events, func(i, j int) bool { return w.Events[i].OccurredAt.Before(w.Events[j].OccurredAt) })
	return w
}

// Golden is Generate(Seed).
func Golden() World { return Generate(Seed) }

var personas = []struct {
	name  string
	build func(*gen)
}{
	{"weekend-couple", weekendCouple},
	{"bin-day", binDay},
	{"solo-irregular", soloIrregular},
	{"habit-changer", habitChanger},
	{"lookalikes", lookalikes},
	{"frequent-travellers", frequentTravellers},
	{"new-house", newHouse},
	{"bursty", bursty},
	{"big-family", bigFamily},
	{"monthly-stocker", monthlyStocker},
}

// ---- generator --------------------------------------------------------------------------------

type gen struct {
	rng    *rand.Rand
	h      *House
	start  time.Time
	loc    *time.Location
	events []analytics.Event
	seq    int
}

func (g *gen) house(tz string, members ...string) {
	g.h.TZ = tz
	g.loc, _ = time.LoadLocation(tz)
	for _, m := range members {
		g.h.Members = append(g.h.Members, g.h.Room+"_"+m)
	}
	for _, m := range g.h.Members {
		g.ev("house.joined", m, "", "", g.start.Add(time.Hour), nil)
	}
}

func (g *gen) member(i int) string { return g.h.Members[i] }

func (g *gen) anyone() string { return g.h.Members[g.rng.Intn(len(g.h.Members))] }

func (g *gen) expect(e ...Expect) { g.h.Expect = append(g.h.Expect, e...) }

// trip adds a trip starting `day` days into the year, lasting `days` days. No travellers: the house.
func (g *gen) trip(day, days int, travellers ...string) *models.Trip {
	s := g.start.In(g.loc).AddDate(0, 0, day)
	start, end := s.Format("2006-01-02"), s.AddDate(0, 0, days-1).Format("2006-01-02")
	t := models.Trip{TripID: fmt.Sprintf("trip_%s_%d", g.h.Room, len(g.h.Trips)), RoomID: g.h.Room, Version: 1}
	t.StartDate, t.EndDate, t.Travellers = &start, &end, travellers
	g.h.Trips = append(g.h.Trips, t)
	return &g.h.Trips[len(g.h.Trips)-1]
}

// local is the local moment `day` days into the year at a fractional hour, jittered by up to
// jitterMin minutes either way.
func (g *gen) local(day int, hour float64, jitterMin float64) time.Time {
	d := g.start.In(g.loc).AddDate(0, 0, day)
	base := time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, g.loc)
	mins := hour*60 + (g.rng.Float64()*2-1)*jitterMin
	return base.Add(time.Duration(mins * float64(time.Minute)))
}

// eveningAfter is a plausible moment to notice something ran out: the same evening, or the next.
func (g *gen) eveningAfter(t time.Time) time.Time {
	l := t.In(g.loc)
	day := time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, g.loc)
	at := day.Add(time.Duration((18 + g.rng.Float64()*4) * float64(time.Hour)))
	if !at.After(t) {
		at = at.AddDate(0, 0, 1)
	}
	return at
}

func (g *gen) ev(name, actor, key, list string, at time.Time, props map[string]any) {
	g.seq++
	e := analytics.Event{
		EventID: fmt.Sprintf("gw:%s:%06d", g.h.Room, g.seq),
		Name:    name, Source: analytics.SourceServer, ActorID: actor, RoomID: g.h.Room, Key: key, OccurredAt: at,
		Subject: analytics.Ref{Type: analytics.SubjectType(name), ID: g.h.Room + ":" + key},
		Props:   props,
	}
	if analytics.SubjectType(name) == "list" || analytics.SubjectType(name) == "app" {
		e.Source = analytics.SourceClient
		e.Subject.ID = g.h.Room + ":" + list
	}
	if list != "" {
		e.Container = &analytics.Ref{Type: "list", ID: g.h.Room + "_" + list}
	}
	analytics.Stamp(&e, at.Add(time.Minute), g.h.TZ, 400*24*time.Hour)
	e.EventID = fmt.Sprintf("gw:%s:%06d", g.h.Room, g.seq)
	g.events = append(g.events, e)
}

// trim drops what happens after End (a minute of ingest lag included).
func trim(evs []analytics.Event) []analytics.Event {
	out := evs[:0]
	for _, e := range evs {
		if e.OccurredAt.Before(End.Add(-10 * time.Minute)) {
			out = append(out, e)
		}
	}
	return out
}

// runs are the house's shopping trips: on a weekday at an hour, every `every` weeks, skipped with
// probability skip, and never while the house is away.
func (g *gen) runs(weekday time.Weekday, hour float64, every int, skip float64, fromDay int) []time.Time {
	away := g.h.Away()
	var out []time.Time
	for day := fromDay; day < 366; day++ {
		d := g.start.In(g.loc).AddDate(0, 0, day)
		if d.Weekday() != weekday {
			continue
		}
		if every > 1 && ((day-fromDay)/7)%every != 0 {
			continue
		}
		at := g.local(day, hour, 40)
		if away.Contains(at) || g.rng.Float64() < skip {
			continue
		}
		out = append(out, at)
	}
	return out
}

// staple is one consumable: used up `gap` days of home time after it is bought (± jitter), with
// optional habit change (gap2 from day switch on) and look-alike names.
type staple struct {
	key         string
	gap, jitter float64
	gap2        float64
	switchDay   int
	names       []string // when set, each purchase is written as one of these
	ignore      float64  // probability a suggestion for it is ignored before the buy
	accept      float64  // probability the add came from taking a suggestion
}

// shop simulates staples bought on runs. At each run the house buys what will run out before
// the next one (someone added it in the days before, when they noticed it getting low); a run
// skipped or missed while away just leaves it for the next. Consumption restarts from the
// purchase and runs on home time.
func (g *gen) shop(list string, runs []time.Time, items []staple) {
	away := g.h.Away()
	for _, it := range items {
		need := g.start.Add(time.Duration(g.rng.Float64() * it.gap * 24 * float64(time.Hour)))
		for i, run := range runs {
			next := End
			if i+1 < len(runs) {
				next = runs[i+1]
			}
			// buy it when it would run out before (about) the next run
			if need.After(run.Add(next.Sub(run) / 2)) {
				continue
			}
			name := it.key
			if len(it.names) > 0 {
				name = it.names[g.rng.Intn(len(it.names))]
			}
			prev := g.start
			if i > 0 {
				prev = runs[i-1]
			}
			added := run.Add(-time.Duration((6 + g.rng.Float64()*66) * float64(time.Hour)))
			if added.Before(prev) || away.Contains(added) {
				added = run.Add(-time.Duration(1+g.rng.Intn(5)) * time.Hour)
			}
			if it.ignore > 0 && g.rng.Float64() < it.ignore {
				g.ev("item.suggestion_ignored", g.anyone(), name, list, added.Add(-24*time.Hour), nil)
			}
			if it.accept > 0 && g.rng.Float64() < it.accept {
				g.ev("item.suggestion_accepted", g.anyone(), name, list, added.Add(-time.Minute), nil)
			}
			g.ev("item.added", g.anyone(), name, list, added, nil)
			bought := run.Add(time.Duration(g.rng.Intn(25)) * time.Minute)
			g.ev("item.checked", g.anyone(), name, list, bought, nil)
			gap := it.gap
			if it.gap2 > 0 && bought.Sub(g.start) > time.Duration(it.switchDay)*24*time.Hour {
				gap = it.gap2
			}
			use := gap * (1 + it.jitter*(g.rng.Float64()*2-1))
			need = away.AddHome(bought, time.Duration(use*24*float64(time.Hour)))
		}
		kind := Staple
		if it.jitter >= 0.6 {
			kind = Irregular
		}
		g.expect(Expect{Key: it.key, Kind: kind})
	}
}

// oneOffs adds n things bought once, on random runs.
func (g *gen) oneOffs(list string, runs []time.Time, n int) {
	for i := 0; i < n && i < len(oneOffNames) && len(runs) > 0; i++ {
		run := runs[g.rng.Intn(len(runs))]
		key := oneOffNames[(i*7+len(g.h.Room))%len(oneOffNames)]
		g.ev("item.added", g.anyone(), key, list, run.Add(-time.Duration(10+g.rng.Intn(60))*time.Hour), nil)
		g.ev("item.checked", g.anyone(), key, list, run.Add(time.Duration(g.rng.Intn(25))*time.Minute), nil)
		g.expect(Expect{Key: key, Kind: OneOff})
	}
}

// views are list.view events the evening before each run (people look before they shop).
func (g *gen) views(list string, runs []time.Time) {
	for _, r := range runs {
		g.ev("list.view", g.anyone(), "", list, r.Add(-time.Duration(14+g.rng.Intn(4))*time.Hour), nil)
	}
}

// oneOffNames are things a house buys once, far enough apart that none is a look-alike of another.
var oneOffNames = []string{
	"birthday candles", "light bulb", "picture hook", "sunscreen", "batteries", "umbrella", "glue",
	"paint brush", "party hats", "ice cube tray", "measuring tape", "garden gloves", "phone charger",
	"spatula", "doormat", "fly spray", "candle", "notebook", "envelopes", "duct tape", "sewing kit",
	"bike pump", "thermometer", "plant pot", "first aid kit", "corkscrew", "wrapping paper", "torch",
	"kettle descaler", "shoe polish", "laundry basket", "lunch box", "water filter", "hand warmers",
	"cookie cutters", "picnic blanket", "extension cord", "padlock", "tea towels", "napkins",
}

// chore is a calendar item done on a weekday every n weeks: it is unchecked the morning after,
// and checked on the day by the member whose turn it is (strict) or by whoever (weights).
func (g *gen) chore(list, key string, weekday time.Weekday, hour float64, every int, strict bool) {
	away := g.h.Away()
	turn := 0
	for day := 0; day < 366; day++ {
		d := g.start.In(g.loc).AddDate(0, 0, day)
		if d.Weekday() != weekday || (day/7)%every != 0 {
			continue
		}
		at := g.local(day, hour, 25)
		if away.Contains(at) {
			continue // nobody home to take the bins out
		}
		who := g.member(turn % len(g.h.Members))
		if strict {
			turn++
		} else if g.rng.Float64() < 0.7 {
			who = g.member(0)
		} else {
			who = g.member(1 % len(g.h.Members))
		}
		g.ev("item.checked", who, key, list, at, nil)
		g.ev("item.unchecked", who, key, list, at.Add(time.Duration(12+g.rng.Intn(4))*time.Hour), nil)
	}
	e := Expect{Key: key, Kind: Calendar, EveryWeeks: every, Weekday: int(weekday), Hour: int(math.Round(hour))}
	if strict {
		e.Turns = append([]string(nil), g.h.Members...)
	}
	g.expect(e)
}

// ---- personas ---------------------------------------------------------------------------------

func weekendCouple(g *gen) {
	g.house("Europe/London", "a", "b")
	g.trip(200, 14)             // summer holiday
	g.trip(290, 4)              // a long weekend away
	g.trip(100, 5, g.member(1)) // b goes alone: the house is still home
	runs := g.runs(time.Saturday, 10, 1, 0.12, 0)
	g.shop("groceries", runs, []staple{
		{key: "milk", gap: 6, jitter: 0.15},
		{key: "eggs", gap: 7, jitter: 0.2},
		{key: "bread", gap: 5, jitter: 0.25},
		{key: "coffee", gap: 13, jitter: 0.15},
		{key: "olive oil", gap: 30, jitter: 0.2},
		{key: "bananas", gap: 5, jitter: 0.2},
		{key: "chocolate", gap: 9, jitter: 0.8},
	})
	g.oneOffs("groceries", runs, 25)
	g.views("groceries", runs)
}

func binDay(g *gen) {
	g.house("America/New_York", "a", "b")
	g.trip(150, 10)
	g.chore("chores", "bin bags", time.Tuesday, 20, 2, true)
	g.chore("chores", "recycling", time.Tuesday, 20, 1, false)
	runs := g.runs(time.Sunday, 11, 1, 0.1, 0)
	g.shop("groceries", runs, []staple{{key: "milk", gap: 7, jitter: 0.15}, {key: "cereal", gap: 14, jitter: 0.2}})
}

func soloIrregular(g *gen) {
	g.house("Asia/Manila", "a")
	away := g.h.Away()
	keys := []string{"instant noodles", "eggs", "soda", "bread", "tuna", "shampoo", "rice", "coffee"}
	for t := g.start.Add(30 * time.Hour); t.Before(End); {
		at := g.eveningAfter(t)
		if !away.Contains(at) {
			for _, k := range keys {
				if g.rng.Float64() < 0.3 {
					g.ev("item.added", g.member(0), k, "list", at, nil)
					g.ev("item.checked", g.member(0), k, "list", at.Add(time.Duration(1+g.rng.Intn(48))*time.Hour), nil)
				}
			}
		}
		t = at.Add(time.Duration(1+g.rng.Intn(12)) * 24 * time.Hour)
	}
	for _, k := range keys {
		g.expect(Expect{Key: k, Kind: Irregular})
	}
}

func habitChanger(g *gen) {
	g.house("Europe/Lisbon", "a", "b")
	g.trip(60, 7)
	runs := append(g.runs(time.Saturday, 11, 1, 0.05, 0), g.runs(time.Wednesday, 19, 1, 0.1, 180)...)
	sort.Slice(runs, func(i, j int) bool { return runs[i].Before(runs[j]) })
	g.shop("groceries", runs, []staple{
		{key: "milk", gap: 7, jitter: 0.1, gap2: 3.5, switchDay: 180},
		{key: "coffee", gap: 14, jitter: 0.1, gap2: 7, switchDay: 200},
		{key: "rice", gap: 21, jitter: 0.15},
	})
}

func lookalikes(g *gen) {
	g.house("Europe/Paris", "a", "b")
	g.trip(220, 9)
	runs := g.runs(time.Saturday, 9.5, 1, 0.1, 0)
	g.shop("groceries", runs, []staple{
		{key: "yogurt", gap: 7, jitter: 0.15, names: []string{"yogurt", "yoghurt", "yogurts"}},
		{key: "tomatoes", gap: 7, jitter: 0.2, names: []string{"tomato", "tomatoes"}},
		{key: "kombucha", gap: 7, jitter: 0.15, ignore: 0.15, accept: 0.4},
		{key: "cheese", gap: 10, jitter: 0.2, accept: 0.5},
	})
	// mid-shop ignores (run mode) do not count against the forecast
	for i, r := range runs {
		if i%5 == 0 {
			g.ev("item.suggestion_ignored", g.anyone(), "kombucha", "groceries", r.Add(5*time.Minute), map[string]any{"during": analytics.DuringRun})
		}
	}
}

func frequentTravellers(g *gen) {
	g.house("Australia/Sydney", "a", "b")
	gone := g.h.Room + "_c"
	g.h.Left = []string{gone}
	for m := 0; m < 12; m++ {
		g.trip(m*30+5+g.rng.Intn(10), 3+g.rng.Intn(5))
	}
	g.trip(40, 6, g.member(0), g.member(1), gone) // a member who left was on it: still the whole house
	g.trip(80, 6, gone)                           // only the one who left: nobody current is away
	g.trip(120, 4, g.member(0))                   // solo
	tokyo := g.trip(250, 6)
	tokyo.TZ = "Asia/Tokyo"
	deleted := g.trip(300, 10)
	at := End
	deleted.DeletedAt = &at
	dateless := g.trip(320, 5)
	dateless.EndDate = nil
	runs := g.runs(time.Saturday, 8.5, 1, 0.1, 0)
	g.shop("groceries", runs, []staple{
		{key: "milk", gap: 7, jitter: 0.15},
		{key: "sourdough", gap: 7, jitter: 0.2},
		{key: "coffee beans", gap: 14, jitter: 0.15},
	})
}

func newHouse(g *gen) {
	g.start = End.AddDate(0, 0, -21)
	g.house("UTC", "a", "b")
	runs := g.runs(time.Saturday, 10, 1, 0, 0)
	for _, k := range []string{"milk", "bread", "eggs"} {
		for _, r := range runs {
			g.ev("item.added", g.anyone(), k, "groceries", r.Add(-30*time.Hour), nil)
			g.ev("item.checked", g.anyone(), k, "groceries", r, nil)
		}
		g.expect(Expect{Key: k, Kind: Thin})
	}
}

func bursty(g *gen) {
	g.house("Europe/Berlin", "a", "b")
	runs := g.runs(time.Friday, 18, 1, 0.1, 0)
	g.shop("groceries", runs, []staple{{key: "milk", gap: 7, jitter: 0.15}, {key: "apples", gap: 7, jitter: 0.2}})
	// double taps: the same add twice within a minute, and check/uncheck/check within minutes
	var extra []analytics.Event
	for _, e := range g.events {
		switch {
		case e.Name == "item.added" && g.rng.Float64() < 0.2:
			extra = append(extra, e)
			extra[len(extra)-1].OccurredAt = e.OccurredAt.Add(40 * time.Second)
		case e.Name == "item.checked" && g.rng.Float64() < 0.3:
			un, re := e, e
			un.Name, un.OccurredAt = "item.unchecked", e.OccurredAt.Add(90*time.Second)
			re.OccurredAt = e.OccurredAt.Add(4 * time.Minute)
			extra = append(extra, un, re)
		}
	}
	for _, e := range extra {
		g.ev(e.Name, e.ActorID, e.Key, "groceries", e.OccurredAt, nil)
	}
}

func bigFamily(g *gen) {
	g.house("Asia/Manila", "a", "b", "c")
	g.trip(330, 6)
	runs := g.runs(time.Sunday, 16, 1, 0.05, 0)
	g.shop("groceries", runs, []staple{
		{key: "rice", gap: 3, jitter: 0.2},
		{key: "drinking water", gap: 2, jitter: 0.25},
		{key: "eggs", gap: 4, jitter: 0.2},
		{key: "chicken", gap: 7, jitter: 0.15},
		{key: "dish soap", gap: 21, jitter: 0.2},
	})
	pharmacy := g.runs(time.Saturday, 15, 4, 0, 3)
	g.shop("pharmacy", pharmacy, []staple{{key: "vitamins", gap: 28, jitter: 0.1}, {key: "paracetamol", gap: 40, jitter: 0.9}})
	g.oneOffs("groceries", runs, 40)
	// d joins mid-year and starts helping
	g.h.Members = append(g.h.Members, g.h.Room+"_d")
	g.ev("house.joined", g.h.Room+"_d", "", "", g.start.AddDate(0, 0, 150), nil)
	g.views("groceries", runs)
}

func monthlyStocker(g *gen) {
	g.house("America/Chicago", "a")
	runs := g.runs(time.Saturday, 13, 4, 0, 2)
	g.shop("stock-up", runs, []staple{
		{key: "toilet paper", gap: 26, jitter: 0.1},
		{key: "detergent", gap: 26, jitter: 0.1},
		{key: "rice", gap: 26, jitter: 0.15},
	})
}
