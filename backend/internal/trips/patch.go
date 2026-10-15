package trips

import (
	"bytes"
	"encoding/json"
	"strings"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

// Opt distinguishes an absent JSON field from an explicit null from a value.
type Opt[T any] struct {
	Set bool
	Val *T
}

func (o *Opt[T]) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(bytes.TrimSpace(b)) == "null" {
		o.Val = nil
		return nil
	}
	var v T
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	o.Val = &v
	return nil
}

type TripPatch struct {
	Title       *string           `json:"title"`
	Destination Opt[models.Place] `json:"destination"`
	Notes       *string           `json:"notes"`
	StartDate   Opt[string]       `json:"start_date"`
	EndDate     Opt[string]       `json:"end_date"`
	TZ          *string           `json:"tz"`
	// Stops replaces the whole route; null or [] clears it.
	Stops Opt[[]models.Place] `json:"stops"`
	// Days sets labels per date; an empty string removes the label.
	Days map[string]string `json:"days"`
}

type TodoPatch struct {
	Title       *string           `json:"title"`
	Done        *bool             `json:"done"`
	Day         Opt[string]       `json:"day"`
	StartTime   Opt[string]       `json:"start_time"`
	DurationMin Opt[int]          `json:"duration_min"`
	Order       *float64          `json:"order"`
	Category    *string           `json:"category"`
	Notes       *string           `json:"notes"`
	Place       Opt[models.Place] `json:"place"`
}

type BookingPatch struct {
	Kind             *string           `json:"kind"`
	Title            *string           `json:"title"`
	ConfirmationCode *string           `json:"confirmation_code"`
	StartsAt         Opt[string]       `json:"starts_at"`
	EndsAt           Opt[string]       `json:"ends_at"`
	StartTZ          Opt[string]       `json:"start_tz"`
	EndTZ            Opt[string]       `json:"end_tz"`
	Place            Opt[models.Place] `json:"place"`
	Notes            *string           `json:"notes"`
}

// decodePatch strictly decodes raw into dst. Unknown fields are "unsupported"
// (a newer client), anything else malformed is "invalid".
func decodePatch(raw json.RawMessage, dst any) string {
	if len(raw) == 0 {
		raw = json.RawMessage("{}")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		if strings.HasPrefix(err.Error(), "json: unknown field") {
			return models.CodeUnsupported
		}
		return models.CodeInvalid
	}
	return ""
}
