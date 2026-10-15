package handlers_test

import (
	"net/http"
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/ratelimit"
)

func TestPackingListEndpointIsRateLimited(t *testing.T) {
	f := newTripFixture(t, nil, ratelimit.New(0.0001, 2))
	path := "/rooms/" + f.roomID + "/trips/" + hTripID + "/packing-list"
	for i := 0; i < 2; i++ {
		if rec := f.post(path, `{}`, nil); rec.Code == http.StatusTooManyRequests {
			t.Fatalf("call %d limited too early", i)
		}
	}
	if rec := f.post(path, `{}`, nil); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("want 429, got %d", rec.Code)
	}
}
