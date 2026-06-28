package parse

import (
	"testing"
)

func TestParseInput(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantDesc    string
		wantQty     string
		wantUnit    string
	}{
		{
			name:     "quantity with unit and description",
			input:    "3 bags Milk",
			wantDesc: "Milk",
			wantQty:  "3",
			wantUnit: "bags",
		},
		{
			name:     "decimal quantity no space",
			input:    "1.5kg Beef",
			wantDesc: "Beef",
			wantQty:  "1.5",
			wantUnit: "kg",
		},
		{
			name:     "quantity unit and multi-word description",
			input:    "2 lbs chicken breast",
			wantDesc: "chicken breast",
			wantQty:  "2",
			wantUnit: "lbs",
		},
		{
			name:     "quantity with non-unit word",
			input:    "2 bell peppers",
			wantDesc: "bell peppers",
			wantQty:  "2",
			wantUnit: "",
		},
		{
			name:     "quantity with adjective non-unit",
			input:    "5 large eggs",
			wantDesc: "large eggs",
			wantQty:  "5",
			wantUnit: "",
		},
		{
			name:     "no quantity no unit",
			input:    "Milk",
			wantDesc: "Milk",
			wantQty:  "",
			wantUnit: "",
		},
		{
			name:     "no quantity no unit multi-word",
			input:    "bell peppers",
			wantDesc: "bell peppers",
			wantQty:  "",
			wantUnit: "",
		},
		{
			name:     "leading and trailing spaces",
			input:    "  Milk  ",
			wantDesc: "Milk",
			wantQty:  "",
			wantUnit: "",
		},
		{
			name:     "special character no space",
			input:    "2% milk",
			wantDesc: "2% milk",
			wantQty:  "",
			wantUnit: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			desc, qty, unit := ParseInput(tt.input)
			if desc != tt.wantDesc {
				t.Errorf("ParseInput(%q) desc = %q, want %q", tt.input, desc, tt.wantDesc)
			}
			if qty != tt.wantQty {
				t.Errorf("ParseInput(%q) qty = %q, want %q", tt.input, qty, tt.wantQty)
			}
			if unit != tt.wantUnit {
				t.Errorf("ParseInput(%q) unit = %q, want %q", tt.input, unit, tt.wantUnit)
			}
		})
	}
}

func TestNormalizeKey(t *testing.T) {
	tests := []struct {
		name string
		input string
		want string
	}{
		{
			name: "quantity unit and description",
			input: "2 lbs Chicken Breast",
			want: "chicken breast",
		},
		{
			name: "internal multiple spaces",
			input: "Chicken   Breast",
			want: "chicken breast",
		},
		{
			name: "decimal quantity no space",
			input: "1.5kg Beef",
			want: "beef",
		},
		{
			name: "single word no quantity",
			input: "Milk",
			want: "milk",
		},
		{
			name: "quantity non-unit word",
			input: "2 bell peppers",
			want: "bell peppers",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NormalizeKey(tt.input)
			if got != tt.want {
				t.Errorf("NormalizeKey(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
