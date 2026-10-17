package analytics

import (
	"fmt"
	"strings"
	"sync"
)

// PropKind constrains a prop value.
type PropKind int

const (
	PropString PropKind = iota
	PropInt
	PropBool
	PropEnum
)

// PropSpec validates one prop of an event.
type PropSpec struct {
	Kind   PropKind
	Values []string // PropEnum
	MaxLen int      // PropString, default 64
	// Min and Max bound a PropInt when Max > 0 (values outside are dropped).
	Min, Max int64
}

// DuringRun is the "during" prop of a suggestion event that happened mid-shop (run mode). A dismiss
// carrying it does not count against the forecast.
const DuringRun = "run"

// Role says how an event feeds the generic per-Key interval model.
type Role int

const (
	RoleNone     Role = iota
	RoleRequest       // the thing was asked for (item.added)
	RoleComplete      // the thing was done (item.checked, recipe.cooked)
	RoleDismiss       // a suggestion for the thing was turned down; it counts against that forecast
)

// EventDef declares one event name. Domains register theirs at startup.
type EventDef struct {
	Name   string
	Props  map[string]PropSpec
	Client bool // may clients send it through POST /events?
	Role   Role
	// Skip excludes high-volume noise (item.reordered) from rollups; it is still stored.
	Skip bool
	// RequeueRoom makes the event a signal, not behavior: folding it counts nothing and marks every
	// key of its room stale, so the room's forecasts are rebuilt (trip.away_changed: the house's away
	// calendar moved, so its home time did too).
	RequeueRoom bool
}

// Registry holds event definitions and aliases (old name -> current name).
type Registry struct {
	mu      sync.RWMutex
	defs    map[string]EventDef
	aliases map[string]string
}

func NewRegistry() *Registry {
	return &Registry{defs: map[string]EventDef{}, aliases: map[string]string{}}
}

// Register adds a definition. The name must be "<subject type>.<verb>".
func (r *Registry) Register(d EventDef) error {
	if i := strings.IndexByte(d.Name, '.'); i <= 0 || i == len(d.Name)-1 {
		return fmt.Errorf("analytics: event name %q must be <subject>.<verb>", d.Name)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, dup := r.defs[d.Name]; dup {
		return fmt.Errorf("analytics: event %q registered twice", d.Name)
	}
	r.defs[d.Name] = d
	return nil
}

// MustRegister panics on a bad definition; it is for startup wiring.
func (r *Registry) MustRegister(defs ...EventDef) {
	for _, d := range defs {
		if err := r.Register(d); err != nil {
			panic(err)
		}
	}
}

// Alias lets events stored under an old name keep folding after a rename.
func (r *Registry) Alias(old, current string) {
	r.mu.Lock()
	r.aliases[old] = current
	r.mu.Unlock()
}

// Resolve returns the current definition for a (possibly aliased) name.
func (r *Registry) Resolve(name string) (EventDef, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if cur, ok := r.aliases[name]; ok {
		name = cur
	}
	d, ok := r.defs[name]
	return d, ok
}

// SubjectType is the part of an event name before the dot.
func SubjectType(name string) string {
	if i := strings.IndexByte(name, '.'); i > 0 {
		return name[:i]
	}
	return name
}

// Sanitize keeps only declared props whose values pass validation; the rest are dropped.
func (d EventDef) Sanitize(in map[string]any) map[string]any {
	if len(in) == 0 || len(d.Props) == 0 {
		return nil
	}
	out := map[string]any{}
	for k, v := range in {
		spec, ok := d.Props[k]
		if !ok {
			continue
		}
		if cv, ok := spec.coerce(v); ok {
			out[k] = cv
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func (s PropSpec) coerce(v any) (any, bool) {
	switch s.Kind {
	case PropString:
		str, ok := v.(string)
		max := s.MaxLen
		if max == 0 {
			max = 64
		}
		return str, ok && len(str) <= max
	case PropEnum:
		str, ok := v.(string)
		if !ok {
			return nil, false
		}
		for _, allowed := range s.Values {
			if str == allowed {
				return str, true
			}
		}
		return nil, false
	case PropBool:
		b, ok := v.(bool)
		return b, ok
	case PropInt:
		var n int64
		switch x := v.(type) {
		case int:
			n = int64(x)
		case int32:
			n = int64(x)
		case int64:
			n = x
		case float64: // JSON numbers
			if x != float64(int64(x)) {
				return nil, false
			}
			n = int64(x)
		default:
			return nil, false
		}
		if s.Max > 0 && (n < s.Min || n > s.Max) {
			return nil, false
		}
		return n, true
	}
	return nil, false
}
