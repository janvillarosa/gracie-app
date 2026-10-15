package handlers_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func (f tripFixture) do(method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Authorization", "Bearer "+f.apiKey)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	f.h.ServeHTTP(rec, req)
	return rec
}

func (f tripFixture) me(t *testing.T) (name string, showNext any, hasPrefs bool) {
	t.Helper()
	rec := f.do(http.MethodGet, "/me", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /me: %d %s", rec.Code, rec.Body)
	}
	var out struct {
		Name        string         `json:"name"`
		Preferences map[string]any `json:"preferences"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	v, ok := out.Preferences["trips_show_next_stop"]
	return out.Name, v, ok
}

func TestMePreferencesDefaultSetAndPartialUpdates(t *testing.T) {
	f := newTripFixture(t, nil, nil)

	name, v, ok := f.me(t)
	if !ok || v != true {
		t.Fatalf("default must resolve to a concrete true, got %v (present=%v)", v, ok)
	}

	if rec := f.do(http.MethodPut, "/me", `{"preferences":{"trips_show_next_stop":false}}`); rec.Code != http.StatusNoContent {
		t.Fatalf("prefs-only PUT: %d %s", rec.Code, rec.Body)
	}
	n2, v, _ := f.me(t)
	if v != false || n2 != name {
		t.Fatalf("pref not set or name clobbered: %q %v", n2, v)
	}

	// name-only update leaves the preference alone
	if rec := f.do(http.MethodPut, "/me", `{"name":"Renamed"}`); rec.Code != http.StatusNoContent {
		t.Fatalf("name-only PUT: %d %s", rec.Code, rec.Body)
	}
	n3, v, _ := f.me(t)
	if n3 != "Renamed" || v != false {
		t.Fatalf("name-only update changed prefs: %q %v", n3, v)
	}

	// both at once, and an empty preferences object alongside a name is fine
	if rec := f.do(http.MethodPut, "/me", `{"name":"Both","preferences":{"trips_show_next_stop":true}}`); rec.Code != http.StatusNoContent {
		t.Fatalf("combined PUT: %d %s", rec.Code, rec.Body)
	}
	n4, v, _ := f.me(t)
	if n4 != "Both" || v != true {
		t.Fatalf("combined: %q %v", n4, v)
	}
	if rec := f.do(http.MethodPut, "/me", `{"name":"Again","preferences":{}}`); rec.Code != http.StatusNoContent {
		t.Fatalf("empty prefs with name: %d", rec.Code)
	}
}

func TestMePutRejectsBadBodies(t *testing.T) {
	f := newTripFixture(t, nil, nil)
	for name, body := range map[string]string{
		"unknown pref key":  `{"preferences":{"nope":true}}`,
		"unknown top key":   `{"name":"x","admin":true}`,
		"wrong pref type":   `{"preferences":{"trips_show_next_stop":"yes"}}`,
		"empty body":        `{}`,
		"empty prefs only":  `{"preferences":{}}`,
		"empty name":        `{"name":""}`,
		"too large":         `{"name":"` + strings.Repeat("a", 5000) + `"}`,
		"not json":          `nope`,
		"null prefs, no op": `{"preferences":null}`,
	} {
		if rec := f.do(http.MethodPut, "/me", body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: want 400, got %d", name, rec.Code)
		}
	}
	// nothing above may have changed the stored preference
	if _, v, _ := f.me(t); v != true {
		t.Fatalf("rejected requests changed state: %v", v)
	}
}
