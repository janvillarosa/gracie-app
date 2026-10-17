package router

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRedactPlacesQueryOnlyTouchesRequestURI(t *testing.T) {
	var uri, raw string
	h := redactPlacesQuery(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uri, raw = r.RequestURI, r.URL.RawQuery
	}))

	req := httptest.NewRequest(http.MethodGet, "/places/reverse?lat=35.01234&lng=135.7&lang=en", nil)
	req.RequestURI = "/places/reverse?lat=35.01234&lng=135.7&lang=en"
	h.ServeHTTP(httptest.NewRecorder(), req)
	if uri != "/places/reverse" {
		t.Fatalf("logged URI still has the query: %q", uri)
	}
	if raw != "lat=35.01234&lng=135.7&lang=en" {
		t.Fatalf("handlers must still see the query: %q", raw)
	}

	req = httptest.NewRequest(http.MethodGet, "/rooms/r/lists?x=1", nil)
	req.RequestURI = "/rooms/r/lists?x=1"
	h.ServeHTTP(httptest.NewRecorder(), req)
	if uri != "/rooms/r/lists?x=1" {
		t.Fatalf("other routes must be untouched: %q", uri)
	}
}

func TestHealthzIsPublicAndOK(t *testing.T) {
	r := NewRouter(nil, Handlers{})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
}
