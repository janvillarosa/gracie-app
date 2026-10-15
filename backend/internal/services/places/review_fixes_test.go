package places

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestNormLangMapsToPhotonSet(t *testing.T) {
	for in, want := range map[string]string{"en": "en", "de-AT": "de", "FR": "fr", "it": "it", "default": "", "ja": "", "": "", "xx-yy": ""} {
		if got := normLang(in); got != want {
			t.Errorf("normLang(%q)=%q want %q", in, got, want)
		}
	}
}

func TestUnsupportedLangIsOmittedUpstream(t *testing.T) {
	var gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		_, _ = w.Write([]byte(photonBody))
	}))
	defer srv.Close()
	s := newSvc(t, srv, time.Second, nil)
	if _, err := s.Search(context.Background(), "kyoto station", nil, nil, "ja", 5); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(gotQuery, "lang=") {
		t.Fatalf("unsupported lang forwarded: %s", gotQuery)
	}
	if _, err := s.Search(context.Background(), "kyoto tower", nil, nil, "de-AT", 5); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(gotQuery, "lang=de") {
		t.Fatalf("supported lang dropped: %s", gotQuery)
	}
}

func TestToPlacesTruncatesAndDropsBadCoordinates(t *testing.T) {
	long := strings.Repeat("é", 500)
	r := &photonResp{}
	mk := func(name string, lng, lat float64) {
		r.Features = append(r.Features, struct {
			Geometry struct {
				Coordinates []float64 `json:"coordinates"`
			} `json:"geometry"`
			Properties struct {
				Name        string `json:"name"`
				Street      string `json:"street"`
				HouseNumber string `json:"housenumber"`
				City        string `json:"city"`
				Town        string `json:"town"`
				Village     string `json:"village"`
				OSMValue    string `json:"osm_value"`
				State       string `json:"state"`
				Country     string `json:"country"`
				OSMID       int64  `json:"osm_id"`
				OSMType     string `json:"osm_type"`
			} `json:"properties"`
		}{
			Geometry: struct {
				Coordinates []float64 `json:"coordinates"`
			}{Coordinates: []float64{lng, lat}},
			Properties: struct {
				Name        string `json:"name"`
				Street      string `json:"street"`
				HouseNumber string `json:"housenumber"`
				City        string `json:"city"`
				Town        string `json:"town"`
				Village     string `json:"village"`
				OSMValue    string `json:"osm_value"`
				State       string `json:"state"`
				Country     string `json:"country"`
				OSMID       int64  `json:"osm_id"`
				OSMType     string `json:"osm_type"`
			}{Name: name, Street: long},
		})
	}
	mk(long, 10, 10)
	mk("bad lat", 10, 91)
	mk("bad lng", 181, 10)
	ps := toPlaces(r, "photon")
	if len(ps) != 1 {
		t.Fatalf("want only the valid place, got %d", len(ps))
	}
	if n := len([]rune(ps[0].Name)); n != 200 {
		t.Fatalf("name runes=%d", n)
	}
	if n := len([]rune(ps[0].Address)); n != 300 {
		t.Fatalf("address runes=%d", n)
	}
}

func TestLazyTZLoadsOnceAndOnlyOnFirstUse(t *testing.T) {
	var loads int32
	l := &lazyTZ{load: func() (TZResolver, error) { atomic.AddInt32(&loads, 1); return fixedTZ{}, nil }}
	if atomic.LoadInt32(&loads) != 0 {
		t.Fatalf("loaded eagerly")
	}
	for i := 0; i < 3; i++ {
		if got := l.TZ(1, 2); got != "Asia/Tokyo" {
			t.Fatalf("tz=%q", got)
		}
	}
	if atomic.LoadInt32(&loads) != 1 {
		t.Fatalf("loads=%d", loads)
	}
}

func TestLazyTZLoadFailureDegradesToEmpty(t *testing.T) {
	var loads int32
	l := &lazyTZ{load: func() (TZResolver, error) { atomic.AddInt32(&loads, 1); return nil, errors.New("no data") }}
	if l.TZ(1, 2) != "" || l.TZ(3, 4) != "" || atomic.LoadInt32(&loads) != 1 {
		t.Fatalf("failure should yield empty tz and not retry; loads=%d", loads)
	}
}

func TestRealLazyTZFResolves(t *testing.T) {
	if got := NewLazyTZF().TZ(35.0, 135.7); got != "Asia/Tokyo" {
		t.Fatalf("tz=%q", got)
	}
}
