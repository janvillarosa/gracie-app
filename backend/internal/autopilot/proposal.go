package autopilot

import "time"

// Kind is what a proposal is for.
type Kind string

const (
	// KindRestock puts something the house buys regularly on its list before the shop.
	KindRestock Kind = "restock"
	// KindHoldBack, KindWelcomeHome and KindOverdue are declared so the vocabulary is settled,
	// but nothing plans them yet (holding perishables back before a trip, the shop after one,
	// chores that are late).
	KindHoldBack    Kind = "hold_back"
	KindWelcomeHome Kind = "welcome_home"
	KindOverdue     Kind = "overdue"
)

// Effect is what applying a proposal does. Every value is in-app and reversible. An effect
// outside Bauhouse (buying, booking, messaging) must never be added here: it needs a new mode and
// the house's explicit consent, and the executor refuses anything it does not know.
type Effect string

// EffectAddToList puts the item on the list, marked as added by autopilot, with Undo.
const EffectAddToList Effect = "add_to_list"

// InApp reports whether an effect stays inside Bauhouse.
func (e Effect) InApp() bool { return e == EffectAddToList }

// Disposition is what to do with a proposal.
type Disposition int

const (
	Drop    Disposition = iota // show nothing
	Suggest                    // show it as a slip; nothing changes until a person acts
	Apply                      // do it (assist mode only), marked, with a reason and Undo
)

func (d Disposition) String() string {
	switch d {
	case Suggest:
		return "suggest"
	case Apply:
		return "apply"
	}
	return "drop"
}

// Horizon is how far ahead a caller looks. The suggestion slip, run mode and the assist ticker
// share one pipeline and differ only in this.
type Horizon string

const (
	HorizonNow          Horizon = "now"            // what is due now (the slip)
	HorizonNextRun      Horizon = "next_run"       // what comes due before the next run (run mode)
	HorizonRunAfterNext Horizon = "run_after_next" // what is needed before the run after next (assist)
)

// Basis is which bar picked a proposal: a confident add forecast (what Suggest would show) or the
// thing's fit to the house's runs (FitRun). Assist adds what either bar picks.
type Basis string

const (
	BasisForecast Basis = "forecast" // the suggest bar: today's Forecast.Confident
	BasisRun      Basis = "run"      // the run-fit bar: Policy.AssistMinScore and AssistMinNeed
)

// Reason says why, in data the app turns into words ("You buy it about every 9 days").
type Reason struct {
	Code   string         `json:"code"`
	Params map[string]any `json:"params,omitempty"`
}

// ReasonEveryDays is the restock reason: Params["days"] is the usual rhythm in whole days.
const ReasonEveryDays = "every_days"

// Proposal is one thing the autopilot could do for a list.
type Proposal struct {
	Kind     Kind
	ListID   string
	Key      string
	Display  string
	Quantity string
	Unit     string
	Category string
	// Confidence is the score of the bar that picked it (Basis): the forecast's backtested score, or
	// the run fit's. Need is the probability the thing is needed before the horizon (0 for the
	// "now" horizons, which do not ask).
	Basis      Basis
	Confidence float64
	Need       float64
	EveryDays  int
	// DueInDays is 0 when the thing's window is open now, else whole days until it opens.
	DueInDays int
	Reason    Reason
	// Cycle names the forecast cycle (the date of its LastAt): one action per thing per cycle.
	Cycle string
	// RunAt is when the run this is planned for starts (zero for the "now" horizon).
	RunAt  time.Time
	Effect Effect

	// The forecast the proposal came from, for measurement records.
	Series            string
	LastAt            time.Time
	OpensAt, ClosesAt time.Time
}
