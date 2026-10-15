package handlers_test

import (
	"net/http"
	"testing"
)

// The Photon proxy is gone: places and maps are now client-side (Google Maps Platform).
func TestPlacesRoutesAreRemoved(t *testing.T) {
	f := newTripFixture(t, nil, nil)
	for _, path := range []string{"/places/search?q=kyoto+station", "/places/reverse?lat=35&lng=135"} {
		for _, method := range []string{http.MethodGet, http.MethodPost} {
			if rec := f.do(method, path, ""); rec.Code != http.StatusNotFound {
				t.Errorf("%s %s: want 404, got %d", method, path, rec.Code)
			}
		}
	}
}
