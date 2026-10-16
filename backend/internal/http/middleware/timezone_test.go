package middleware

import (
	"context"
	stdhttp "net/http"
	"net/http/httptest"
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	api "github.com/janvillarosa/gracie-app/backend/internal/http"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func TestTimezoneAcceptsOnlyValidZones(t *testing.T) {
	cases := map[string]string{"America/New_York": "America/New_York", "Not/AZone": "", "": ""}
	for header, want := range cases {
		var got string
		h := Timezone(stdhttp.HandlerFunc(func(_ stdhttp.ResponseWriter, r *stdhttp.Request) { got = analytics.TZFrom(r.Context()) }))
		req := httptest.NewRequest("GET", "/", nil)
		if header != "" {
			req.Header.Set("X-Timezone", header)
		}
		h.ServeHTTP(httptest.NewRecorder(), req)
		if got != want {
			t.Errorf("header %q: got %q want %q", header, got, want)
		}
	}
}

type tzSpy struct{ calls []string }

func (s *tzSpy) UpdateTZ(_ context.Context, id, tz string) error {
	s.calls = append(s.calls, id+"="+tz)
	return nil
}

func TestSyncTimezoneWritesOnlyOnChange(t *testing.T) {
	spy := &tzSpy{}
	h := SyncTimezone(spy)(stdhttp.HandlerFunc(func(stdhttp.ResponseWriter, *stdhttp.Request) {}))
	u := &models.User{UserID: "u1"}
	do := func() {
		ctx := analytics.WithTZ(api.WithUser(context.Background(), u), "Asia/Manila")
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil).WithContext(ctx))
	}
	do()
	do()
	if len(spy.calls) != 1 || spy.calls[0] != "u1=Asia/Manila" {
		t.Fatalf("calls: %v", spy.calls)
	}
}
