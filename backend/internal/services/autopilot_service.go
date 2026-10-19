package services

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"strings"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/autopilot"
	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
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

const maxKeyLen = 128

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

// AutopilotService is the one service behind the house's autopilot: it proposes (suggestions),
// tells the List page how to spot a run, and, in assist mode, applies in-app actions. It turns the
// precomputed add forecasts into suggestions for one list. It
// keeps no state of its own: every answer is derived from analytics and the live list.
type AutopilotService struct {
	emitter
	rooms  store.RoomRepository
	lists  store.ListRepository
	items  store.ListItemRepository
	reader *analytics.Reader
	events analytics.EventRepository
	away   analytics.AwayCalendar
	policy autopilot.Policy
	// The executor (assist mode): the action log and the list service that creates items.
	actions store.AutopilotActionRepository
	listSvc *ListService
	// The ticker: its lease owner id and how close a run must be before assist plans for it.
	owner string
	lead  time.Duration
	mode  SuggestionMode
	now   func() time.Time
}

// NewAutopilotService takes a nil reader or event repository when analytics is disabled;
// the service then always answers with nothing.
func NewAutopilotService(rooms store.RoomRepository, lists store.ListRepository, items store.ListItemRepository, reader *analytics.Reader, events analytics.EventRepository, mode SuggestionMode) *AutopilotService {
	return &AutopilotService{rooms: rooms, lists: lists, items: items, reader: reader, events: events, mode: mode, policy: autopilot.DefaultPolicy, owner: newTickerOwner(), now: time.Now}
}

// UseAwayCalendar tells the planner when the whole house is away (trips), so assist plans no
// adds for a run the house will miss. Nil: nobody is ever away.
func (s *AutopilotService) UseAwayCalendar(c analytics.AwayCalendar) { s.away = c }

// houseMode is the house's own autopilot setting.
func houseMode(room *models.Room) autopilot.Mode {
	return autopilot.HouseMode(room.AutopilotMode, room.SuggestionsOff)
}

// enabled reports whether the service can plan at all: analytics is on and the operator switch
// (SUGGESTIONS_MODE) is not off.
func (s *AutopilotService) enabled() bool {
	return s.mode != SuggestionsOff && s.reader != nil && s.events != nil
}

// WithClock replaces the clock (tests move through a forecast window with it).
func (s *AutopilotService) WithClock(now func() time.Time) *AutopilotService {
	s.now = now
	return s
}

func (s *AutopilotService) checkList(ctx context.Context, user *models.User, roomID, listID string) (*models.Room, error) {
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

// Suggestions returns up to limit suggestions for a list, most confident first. during "run" widens
// the window to what comes due before the house's next run on this list (open ones first, then
// soonest); with no learned run rhythm for the list there is nothing to suggest in run mode. It is
// the shared pipeline (Gather, Plan, Decide) at the "now" or "next_run" horizon, and never writes.
// Only suggest mode suggests: off shows nothing, and assist adds instead.
func (s *AutopilotService) Suggestions(ctx context.Context, user *models.User, roomID, listID string, limit int, during string) ([]Suggestion, error) {
	if !validDuring(during) {
		return nil, derr.ErrBadRequest
	}
	room, err := s.checkList(ctx, user, roomID, listID)
	if err != nil {
		return nil, err
	}
	out := []Suggestion{}
	mode := houseMode(room)
	// The modes do not mix: on assist, what would be suggested is added instead (by the ticker).
	if !s.enabled() || !autopilot.Has(mode, autopilot.FeatureSuggestions) {
		return out, nil
	}
	h := autopilot.HorizonNow
	if during == DuringRun {
		h = autopilot.HorizonNextRun
	}
	snap, err := autopilot.Gather(ctx, s.signals(), autopilot.Query{RoomID: roomID, ListID: listID, Horizon: h, Now: s.now().UTC(), Limit: limit}, s.policy)
	if err != nil {
		return nil, err
	}
	for _, pr := range autopilot.Plan(snap, s.policy) {
		if autopilot.Decide(mode, pr, s.policy) == autopilot.Drop {
			continue
		}
		s.recordPrediction(ctx, user, roomID, listID, pr, during == DuringRun)
		out = append(out, toSuggestion(pr))
	}
	return out, nil
}

func toSuggestion(pr autopilot.Proposal) Suggestion {
	return Suggestion{
		Key: pr.Key, Description: pr.Display, Quantity: pr.Quantity, Unit: pr.Unit, Category: pr.Category,
		EveryDays: pr.EveryDays, Score: math.Round(pr.Confidence*100) / 100, DueInDays: pr.DueInDays,
	}
}

// Ignore turns down the suggestion for key on this list for the current cycle. It is
// recorded as an analytics event: the next forecast counts it as a miss, and Suggestions skips
// the key until the house adds it again.
//
// A run-mode ignore (during "run") still counts toward pausing the list, but not against the
// forecast, and it only hides the key from run mode: it comes back when it is actually due.
func (s *AutopilotService) Ignore(ctx context.Context, user *models.User, roomID, listID, key, during string) error {
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

// recordPrediction stores one measurement record per key and cycle (the id is derived from
// both, so repeated list views write the same event and the store keeps one).
func (s *AutopilotService) recordPrediction(ctx context.Context, user *models.User, roomID, listID string, pr autopilot.Proposal, duringRun bool) {
	seed := roomID + "\x00" + pr.Key + "\x00" + pr.LastAt.UTC().Format(time.RFC3339Nano)
	if duringRun {
		seed += "\x00" + DuringRun // a run-mode prediction is measured on its own
	}
	sum := sha256.Sum256([]byte(seed))
	props := map[string]any{
		"mode":      string(s.mode),
		"score_pct": int64(math.Round(pr.Confidence * 100)),
		"opens_at":  pr.OpensAt.UTC().Format(time.RFC3339),
		"closes_at": pr.ClosesAt.UTC().Format(time.RFC3339),
		"series":    pr.Series,
	}
	if duringRun {
		props["during"] = DuringRun
	}
	s.emit(ctx, analytics.Event{
		EventID: "sp_" + hex.EncodeToString(sum[:12]),
		Name:    "item.suggestion_predicted", ActorID: user.UserID, RoomID: roomID,
		Subject: analytics.Ref{Type: "item"}, Container: ref(listRef(listID)), Key: pr.Key,
		Props: props,
	})
}
