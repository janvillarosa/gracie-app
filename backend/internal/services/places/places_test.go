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

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/ratelimit"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

const photonBody = `{"features":[{"geometry":{"coordinates":[135.7585,34.9858]},"properties":{"name":"Kyoto Station","street":"Karasuma","housenumber":"1","city":"Kyoto","country":"Japan","osm_id":123,"osm_type":"W"}}]}`

func photonServer(t *testing.T, hits *int32, status int, body string, delay time.Duration) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(hits, 1)
		if r.Header.Get("User-Agent") == "" {
			t.Errorf("upstream request must carry a User-Agent")
		}
		time.Sleep(delay)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv
}

type fixedTZ struct{}

func (fixedTZ) TZ(lat, lng float64) string { return "Asia/Tokyo" }

func newSvc(t *testing.T, srv *httptest.Server, timeout time.Duration, server *ratelimit.Limiter) *Service {
	var g Geocoder
	if srv != nil {
		g = NewPhoton(srv.URL, "bauhouse-test/1.0", timeout, srv.Client())
	}
	if server == nil {
		server = ratelimit.New(1000, 1000)
	}
	return NewService(g, fixedTZ{}, memstore.Compose().Places, server)
}

func TestSearchParsesPhotonAndFillsTZ(t *testing.T) {
	var hits int32
	s := newSvc(t, photonServer(t, &hits, 200, photonBody, 0), time.Second, nil)
	res, err := s.Search(context.Background(), "Kyoto Station", nil, nil, "en", 5)
	if err != nil || res.Degraded || len(res.Results) != 1 {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	p := res.Results[0]
	if p.Name != "Kyoto Station" || p.Lat != 34.9858 || p.Lng != 135.7585 || p.TZ != "Asia/Tokyo" || p.Source != "photon" || p.OSMRef != "W123" {
		t.Fatalf("place: %+v", p)
	}
	if !strings.Contains(p.Address, "Kyoto") {
		t.Fatalf("address: %q", p.Address)
	}
}

func TestSearchIsCachedAndKeyIsNormalised(t *testing.T) {
	var hits int32
	s := newSvc(t, photonServer(t, &hits, 200, photonBody, 0), time.Second, nil)
	lat, lng := 35.04, 135.71
	lat2, lng2 := 35.049, 135.749 // same 0.1° cell
	_, _ = s.Search(context.Background(), "  Kyoto Station ", &lat, &lng, "en", 5)
	res, _ := s.Search(context.Background(), "kyoto station", &lat2, &lng2, "en", 5)
	if atomic.LoadInt32(&hits) != 1 || len(res.Results) != 1 {
		t.Fatalf("second call should hit the cache; upstream hits=%d", hits)
	}
}

func TestSearchValidation(t *testing.T) {
	var hits int32
	s := newSvc(t, photonServer(t, &hits, 200, photonBody, 0), time.Second, nil)
	for _, q := range []string{"", "ab", "  a "} {
		if _, err := s.Search(context.Background(), q, nil, nil, "en", 5); !errors.Is(err, derr.ErrBadRequest) {
			t.Fatalf("q=%q should be a bad request, got %v", q, err)
		}
	}
	bad := 123.0
	if _, err := s.Search(context.Background(), "kyoto", &bad, &bad, "en", 5); !errors.Is(err, derr.ErrBadRequest) {
		t.Fatalf("out-of-range coordinates: %v", err)
	}
	if atomic.LoadInt32(&hits) != 0 {
		t.Fatalf("invalid requests must not reach the upstream")
	}
}

func TestUpstreamFailureTimeoutAndNoGeocoderDegrade(t *testing.T) {
	var hits int32
	cases := map[string]*Service{
		"5xx":     newSvc(t, photonServer(t, &hits, 503, "down", 0), time.Second, nil),
		"timeout": newSvc(t, photonServer(t, &hits, 200, photonBody, 300*time.Millisecond), 50*time.Millisecond, nil),
		"garbage": newSvc(t, photonServer(t, &hits, 200, "<html>", 0), time.Second, nil),
		"none":    newSvc(t, nil, time.Second, nil),
	}
	for name, s := range cases {
		res, err := s.Search(context.Background(), "kyoto station", nil, nil, "en", 5)
		if err != nil || !res.Degraded || len(res.Results) != 0 || res.Results == nil {
			t.Fatalf("%s: want degraded empty list, got %+v err=%v", name, res, err)
		}
	}
}

func TestDegradedResultsAreNotCached(t *testing.T) {
	var hits int32
	s := newSvc(t, photonServer(t, &hits, 503, "down", 0), time.Second, nil)
	_, _ = s.Search(context.Background(), "kyoto station", nil, nil, "en", 5)
	_, _ = s.Search(context.Background(), "kyoto station", nil, nil, "en", 5)
	if atomic.LoadInt32(&hits) != 2 {
		t.Fatalf("failures must not poison the cache; hits=%d", hits)
	}
}

func TestServerWideLimiterProtectsUpstream(t *testing.T) {
	var hits int32
	s := newSvc(t, photonServer(t, &hits, 200, photonBody, 0), time.Second, ratelimit.New(0.0001, 1))
	if _, err := s.Search(context.Background(), "kyoto station", nil, nil, "en", 5); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Search(context.Background(), "osaka castle", nil, nil, "en", 5); !errors.Is(err, derr.ErrRateLimited) {
		t.Fatalf("want ErrRateLimited, got %v", err)
	}
}

func TestReverse(t *testing.T) {
	var hits int32
	s := newSvc(t, photonServer(t, &hits, 200, photonBody, 0), time.Second, nil)
	res, err := s.Reverse(context.Background(), 34.9858, 135.7585, "en")
	if err != nil || len(res.Results) != 1 || res.Results[0].Source != "pin" {
		t.Fatalf("reverse: %+v %v", res, err)
	}
	if _, err := s.Reverse(context.Background(), 200, 0, "en"); !errors.Is(err, derr.ErrBadRequest) {
		t.Fatalf("bad coords: %v", err)
	}
	_ = models.Place{}
}
