package services

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/parse"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
)

// SuggestionMode is the switch for smart suggestions (SUGGESTIONS_MODE). There is no shadow
// mode: a suggestion shows as soon as its forecast clears the confidence bar (Forecast.Confident),
// so the only gate is enough history to be sure.
type SuggestionMode string

const (
	SuggestionsOff SuggestionMode = "off" // nothing is computed
	SuggestionsOn  SuggestionMode = "on"  // shown, and recorded so live precision stays visible
)

// ParseSuggestionMode falls back to on. legacy reports a retired "shadow" value, which now runs
// as on, so the caller can log that a stale setting is being ignored.
func ParseSuggestionMode(s string) (mode SuggestionMode, legacy bool) {
	switch SuggestionMode(strings.ToLower(strings.TrimSpace(s))) {
	case SuggestionsOff:
		return SuggestionsOff, false
	case "shadow":
		return SuggestionsOn, true
	}
	return SuggestionsOn, false
}

// AddSourceSuggestion marks an item.added that came from tapping a suggestion.
const AddSourceSuggestion = "suggestion"

type addSourceKey struct{}

// WithAddSource tags the request so the item.added event says where the add came from.
func WithAddSource(ctx context.Context, source string) context.Context {
	if source != AddSourceSuggestion {
		return ctx
	}
	return context.WithValue(ctx, addSourceKey{}, source)
}

func addSourceFrom(ctx context.Context) string {
	s, _ := ctx.Value(addSourceKey{}).(string)
	return s
}

const (
	// homeListShare is how much of an item's activity must happen on a list for it to be
	// suggested there: milk is suggested on the groceries list, not on a party list.
	homeListShare = 0.6
	// upcomingScan bounds the candidates read per request (a point-indexed range).
	upcomingScan = 20
	maxKeyLen    = 128
	// pauseAfterIgnores: this many ignores in a row on a list (none accepted in between) mean the house
	// is not interested right now. Suggestions on that list pause for pauseFor, then try again.
	pauseAfterIgnores = 2
	pauseFor          = 14 * 24 * time.Hour
	// maxRunLookahead caps how far ahead run mode looks for things that come due before the next shop.
	maxRunLookahead = 14 * 24 * time.Hour
)

// DuringRun asks for run-mode suggestions: the person is mid-shop, so offer what comes due before
// their next run, not only what is due now.
const DuringRun = analytics.DuringRun

func validDuring(during string) bool { return during == "" || during == DuringRun }

// Suggestion is one thing the house usually adds around now.
type Suggestion struct {
	Key         string  `json:"key"`
	Description string  `json:"description"`
	Quantity    string  `json:"quantity,omitempty"`
	Unit        string  `json:"unit,omitempty"`
	Category    string  `json:"category,omitempty"`
	EveryDays   int     `json:"every_days"`
	Score       float64 `json:"score"`
	// DueInDays is 0 when the suggestion's window is open now, else the whole days until it opens
	// (run mode only).
	DueInDays int `json:"due_in_days"`
}

// SuggestionService turns the precomputed add forecasts into suggestions for one list. It
// keeps no state of its own: every answer is derived from analytics and the live list.
type SuggestionService struct {
	emitter
	rooms  store.RoomRepository
	lists  store.ListRepository
	items  store.ListItemRepository
	reader *analytics.Reader
	events analytics.EventRepository
	mode   SuggestionMode
	now    func() time.Time
}

// NewSuggestionService takes a nil reader or event repository when analytics is disabled;
// the service then always answers with nothing.
func NewSuggestionService(rooms store.RoomRepository, lists store.ListRepository, items store.ListItemRepository, reader *analytics.Reader, events analytics.EventRepository, mode SuggestionMode) *SuggestionService {
	return &SuggestionService{rooms: rooms, lists: lists, items: items, reader: reader, events: events, mode: mode, now: time.Now}
}

// WithClock replaces the clock (tests move through a forecast window with it).
func (s *SuggestionService) WithClock(now func() time.Time) *SuggestionService {
	s.now = now
	return s
}

func (s *SuggestionService) checkList(ctx context.Context, user *models.User, roomID, listID string) (*models.Room, error) {
	if err := ensureRoomMembership(ctx, s.rooms, user, roomID); err != nil {
		return nil, err
	}
	l, err := s.lists.GetByID(ctx, listID)
	if err != nil {
		return nil, err
	}
	if l.RoomID != roomID || l.IsDeleted {
		return nil, derr.ErrForbidden
	}
	return s.rooms.GetByID(ctx, roomID)
}

type candidate struct {
	stat     analytics.KeyStat
	add      *analytics.AddForecast
	dueIn    int // days until its window opens (0: open now)
	duringRn bool
}

// ForList returns up to limit suggestions for a list, most confident first. during "run" widens
// the window to what comes due before the house's next run on this list (open ones first, then
// soonest); with no learned run rhythm for the list there is nothing to suggest in run mode.
func (s *SuggestionService) ForList(ctx context.Context, user *models.User, roomID, listID string, limit int, during string) ([]Suggestion, error) {
	if !validDuring(during) {
		return nil, derr.ErrBadRequest
	}
	room, err := s.checkList(ctx, user, roomID, listID)
	if err != nil {
		return nil, err
	}
	out := []Suggestion{}
	if s.mode == SuggestionsOff || s.reader == nil || s.events == nil || room.SuggestionsOff {
		return out, nil
	}
	now := s.now().UTC()
	if paused, err := s.pausedByIgnores(ctx, roomID, listID, now); err != nil || paused {
		return out, err
	}
	opensBefore := now
	if during == DuringRun {
		ahead, err := s.runLookahead(ctx, roomID, listID)
		if err != nil || ahead == 0 {
			return out, err
		}
		opensBefore = now.Add(ahead)
	}
	stats, err := s.reader.Upcoming(ctx, roomID, "item", now, opensBefore, upcomingScan)
	if err != nil {
		return nil, err
	}
	onList, err := s.keysOnList(ctx, listID)
	if err != nil {
		return nil, err
	}
	// Look-alike names ("orange", "oranges") share one history, so they would all qualify at
	// once: keep only the most confident name of each, and treat any of them on the list as on it.
	var cands []candidate
	var taken []string
	for _, st := range stats {
		if st.Intervals == nil || st.Intervals.Add == nil || !isHomeList(st.Containers, listID) {
			continue
		}
		if likeAny(st.Key, taken) {
			continue
		}
		taken = append(taken, st.Key)
		if onListLike(onList, st.Key) {
			continue
		}
		cands = append(cands, candidate{stat: st, add: st.Intervals.Add, dueIn: daysUntilOpen(st.Intervals.Add, now), duringRn: during == DuringRun})
	}
	if len(cands) == 0 {
		return out, nil
	}
	// Open ones first, then soonest (Upcoming already ranks by confidence), before the limit applies.
	sort.SliceStable(cands, func(i, j int) bool { return cands[i].dueIn < cands[j].dueIn })
	var display map[string]*PantryItem
	for _, c := range cands {
		if len(out) >= limit {
			break
		}
		fresh, err := s.currentCycleIsOpen(ctx, roomID, c)
		if err != nil {
			return nil, err
		}
		if !fresh {
			continue
		}
		s.recordPrediction(ctx, user, roomID, listID, c)
		if display == nil {
			items, err := s.items.ListByRoom(ctx, roomID)
			if err != nil {
				return nil, err
			}
			display, _ = pantryByKey(items)
		}
		sg := toSuggestion(c, displayFor(display, c.stat.Key))
		sg.DueInDays = c.dueIn
		out = append(out, sg)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].DueInDays != out[j].DueInDays {
			return out[i].DueInDays < out[j].DueInDays
		}
		return out[i].Score > out[j].Score
	})
	return out, nil
}

// runLookahead is how far run mode looks ahead on a list: the house's learned run interval there,
// capped at maxRunLookahead; 0 when no run rhythm has been learned yet.
func (s *SuggestionService) runLookahead(ctx context.Context, roomID, listID string) (time.Duration, error) {
	p, err := s.reader.HouseProfile(ctx, roomID)
	if err != nil || p == nil {
		return 0, err
	}
	c, ok := p.Containers["list:"+listID]
	if !ok || c.Runs < predict.MinOccurrences || c.IntervalDay <= 0 {
		return 0, nil
	}
	return min(time.Duration(c.IntervalDay*24*float64(time.Hour)), maxRunLookahead), nil
}

// daysUntilOpen is 0 when a window is open at now, else the whole days (rounded up) until the
// earliest window that has not closed opens.
func daysUntilOpen(a *analytics.AddForecast, now time.Time) int {
	spans := append([]analytics.ForecastWindow{{Opens: a.OpensAt, Closes: a.ClosesAt}}, a.Windows...)
	var next time.Time
	for _, w := range spans {
		if w.Closes.Before(now) {
			continue
		}
		if !w.Opens.After(now) {
			return 0
		}
		if next.IsZero() || w.Opens.Before(next) {
			next = w.Opens
		}
	}
	if next.IsZero() {
		return 0
	}
	return int(math.Ceil(next.Sub(now).Hours() / 24))
}

// Ignore turns down the suggestion for key on this list for the current cycle. It is
// recorded as an analytics event: the next forecast counts it as a miss, and ForList skips
// the key until the house adds it again.
//
// A run-mode ignore (during "run") still counts toward pausing the list, but not against the
// forecast, and it only hides the key from run mode: it comes back when it is actually due.
func (s *SuggestionService) Ignore(ctx context.Context, user *models.User, roomID, listID, key, during string) error {
	if !validDuring(during) {
		return derr.ErrBadRequest
	}
	if _, err := s.checkList(ctx, user, roomID, listID); err != nil {
		return err
	}
	if key == "" || len(key) > maxKeyLen {
		return derr.ErrBadRequest
	}
	if s.reader == nil {
		return nil // analytics is off: nothing was suggested, nothing to remember
	}
	known, err := s.reader.KeyStats(ctx, roomID, "item", []string{key})
	if err != nil {
		return err
	}
	if _, ok := known[key]; !ok {
		return derr.ErrNotFound
	}
	// Synchronous: the client asks what comes next right away, and must not be offered this again.
	ev := analytics.Event{
		Name: "item.suggestion_ignored", ActorID: user.UserID, RoomID: roomID,
		Subject: analytics.Ref{Type: "item"}, Container: ref(listRef(listID)), Key: key,
	}
	if during != "" {
		ev.Props = map[string]any{"during": during}
	}
	s.emitSync(ctx, ev)
	return nil
}

// pausedByIgnores reports whether the house's last pauseAfterIgnores reactions to suggestions on
// this list were all ignores. It reads only events (ignores and accepted adds), so there is no
// state to reset: an accepted suggestion ends the streak, and the pause lapses on its own.
func (s *SuggestionService) pausedByIgnores(ctx context.Context, roomID, listID string, now time.Time) (bool, error) {
	evs, err := s.events.ListByContainer(ctx, roomID, "list", listID,
		[]string{"item.suggestion_ignored", "item.suggestion_accepted"}, now.Add(-pauseFor), pauseAfterIgnores)
	if err != nil || len(evs) < pauseAfterIgnores {
		return false, err
	}
	for _, e := range evs {
		if e.Name != "item.suggestion_ignored" {
			return false, nil
		}
	}
	return true, nil
}

func (s *SuggestionService) keysOnList(ctx context.Context, listID string) (map[string]bool, error) {
	items, err := s.items.ListByList(ctx, listID)
	if err != nil {
		return nil, err
	}
	// Only what is still to get counts as on the list. A checked item was bought: many houses
	// never clear their list, so checked rows pile up and would otherwise block every suggestion.
	// A purchase in the current cycle is caught by currentCycleIsOpen instead.
	keys := make(map[string]bool, len(items))
	for _, it := range items {
		if !it.IsArchived && !it.Completed {
			keys[parse.NormalizeKey(it.Description)] = true
		}
	}
	return keys, nil
}

// likeAny reports whether key names the same thing as any of keys.
func likeAny(key string, keys []string) bool {
	for _, k := range keys {
		if parse.Similar(key, k) {
			return true
		}
	}
	return false
}

// onListLike reports whether the list holds key or a look-alike of it ("Oranges" for "orange").
func onListLike(onList map[string]bool, key string) bool {
	if onList[key] {
		return true
	}
	for k := range onList {
		if parse.Similar(key, k) {
			return true
		}
	}
	return false
}

// displayFor picks how to show key: the most recent wording the house used for it or any
// look-alike ("Oranges" if that is what they typed last), with that item's quantity and unit.
func displayFor(pantry map[string]*PantryItem, key string) *PantryItem {
	best := pantry[key]
	for k, p := range pantry {
		if k == key || !parse.Similar(key, k) {
			continue
		}
		if best == nil || p.LastAddedAt.After(best.LastAddedAt) {
			best = p
		}
	}
	return best
}

// isHomeList reports whether most of a key's activity happens on listID.
func isHomeList(containers map[string]int64, listID string) bool {
	var total int64
	for _, n := range containers {
		total += n
	}
	if total == 0 {
		return false
	}
	return float64(containers["list:"+listID])/float64(total) >= homeListShare
}

// currentCycleIsOpen reads the raw events for the key (they are fresher than the rollup) and
// says no when the house ignored the suggestion this cycle, or already added or checked the
// thing since the forecast was computed (the rollup has not caught up yet).
func (s *SuggestionService) currentCycleIsOpen(ctx context.Context, roomID string, c candidate) (bool, error) {
	evs, err := s.events.ListForKey(ctx, roomID, "item", c.stat.Key, 50)
	if err != nil {
		return false, err
	}
	// Only the kind of event the forecast learned from starts a new cycle: checking off what was
	// added (the purchase itself, often a day later) is part of the same cycle.
	cycleEvent := "item.added"
	if c.add.Series == predict.SeriesChecked {
		cycleEvent = "item.checked"
	}
	since := c.add.LastAt.Add(predict.MinGap)
	for _, e := range evs {
		switch e.Name {
		case "item.suggestion_ignored":
			// A run-mode ignore only hides the key from run mode for this cycle.
			if e.Props["during"] == DuringRun && !c.duringRn {
				continue
			}
			if e.OccurredAt.After(c.add.LastAt) {
				return false, nil
			}
		case cycleEvent:
			if e.OccurredAt.After(since) {
				return false, nil
			}
		}
	}
	return true, nil
}

// recordPrediction stores one measurement record per key and cycle (the id is derived from
// both, so repeated list views write the same event and the store keeps one).
func (s *SuggestionService) recordPrediction(ctx context.Context, user *models.User, roomID, listID string, c candidate) {
	seed := roomID + "\x00" + c.stat.Key + "\x00" + c.add.LastAt.UTC().Format(time.RFC3339Nano)
	if c.duringRn {
		seed += "\x00" + DuringRun // a run-mode prediction is measured on its own
	}
	sum := sha256.Sum256([]byte(seed))
	props := map[string]any{
		"mode":      string(s.mode),
		"score_pct": int64(math.Round(c.add.Score * 100)),
		"opens_at":  c.add.OpensAt.UTC().Format(time.RFC3339),
		"closes_at": c.add.ClosesAt.UTC().Format(time.RFC3339),
		"series":    c.add.Series,
	}
	if c.duringRn {
		props["during"] = DuringRun
	}
	s.emit(ctx, analytics.Event{
		EventID: "sp_" + hex.EncodeToString(sum[:12]),
		Name:    "item.suggestion_predicted", ActorID: user.UserID, RoomID: roomID,
		Subject: analytics.Ref{Type: "item"}, Container: ref(listRef(listID)), Key: c.stat.Key,
		Props: props,
	})
}

func toSuggestion(c candidate, p *PantryItem) Suggestion {
	sg := Suggestion{
		Key: c.stat.Key, Description: c.stat.Key, Category: c.stat.Category,
		EveryDays: max(1, int(math.Round(c.add.EWMADays))), Score: math.Round(c.add.Score*100) / 100,
	}
	if p != nil {
		sg.Description, sg.Quantity, sg.Unit = p.Description, p.Quantity, p.Unit
		if p.Category != "" {
			sg.Category = p.Category
		}
	} else {
		sg.Description = capitalizeFirst(c.stat.Key)
	}
	return sg
}
