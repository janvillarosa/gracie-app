package places

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/ratelimit"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
)

var reLang = regexp.MustCompile(`^[a-z]{2}(-[A-Za-z]{2})?$`)

// Result is the places API payload.
type Result struct {
	Results  []models.Place `json:"results"`
	Degraded bool           `json:"degraded,omitempty"`
}

type Service struct {
	geo    Geocoder // may be nil: places are then always degraded
	tz     TZResolver
	cache  store.PlaceCacheRepository
	server *ratelimit.Limiter
}

func NewService(g Geocoder, tz TZResolver, cache store.PlaceCacheRepository, server *ratelimit.Limiter) *Service {
	return &Service{geo: g, tz: tz, cache: cache, server: server}
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }

func validCoords(lat, lng float64) bool {
	return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !math.IsNaN(lat) && !math.IsNaN(lng)
}

func normLang(l string) string {
	if reLang.MatchString(l) {
		return l
	}
	return "en"
}

func cacheKey(q string, lat, lng *float64, lang string) string {
	loc := "-"
	if lat != nil && lng != nil {
		loc = fmt.Sprintf("%.1f,%.1f", round1(*lat), round1(*lng))
	}
	sum := sha256.Sum256([]byte("v2|" + q + "|" + loc + "|" + lang))
	return hex.EncodeToString(sum[:])
}

func (s *Service) fillTZ(ps []models.Place) {
	for i := range ps {
		if ps[i].TZ == "" && s.tz != nil {
			ps[i].TZ = s.tz.TZ(ps[i].Lat, ps[i].Lng)
		}
	}
}

func degraded() Result { return Result{Results: []models.Place{}, Degraded: true} }

func (s *Service) Search(ctx context.Context, q string, lat, lng *float64, lang string, limit int) (Result, error) {
	q = strings.ToLower(strings.TrimSpace(q))
	if utf8.RuneCountInString(q) < 3 || utf8.RuneCountInString(q) > 100 {
		return Result{}, derr.ErrBadRequest
	}
	if (lat == nil) != (lng == nil) || (lat != nil && !validCoords(*lat, *lng)) {
		return Result{}, derr.ErrBadRequest
	}
	if limit < 1 || limit > 10 {
		limit = 5
	}
	lang = normLang(lang)
	key := cacheKey(q, lat, lng, lang)
	if cached, ok, err := s.cache.Get(ctx, key); err == nil && ok {
		return Result{Results: cached}, nil
	}
	if s.geo == nil {
		return degraded(), nil
	}
	if !s.server.Allow("places") {
		return Result{}, derr.ErrRateLimited
	}
	ps, err := s.geo.Search(ctx, q, lat, lng, lang, limit)
	if err != nil {
		return degraded(), nil // never a 5xx: the client falls back to manual place / pin
	}
	s.fillTZ(ps)
	if len(ps) > 0 {
		_ = s.cache.Put(ctx, key, ps, time.Now().UTC())
	}
	return Result{Results: ps}, nil
}

func (s *Service) Reverse(ctx context.Context, lat, lng float64, lang string) (Result, error) {
	if !validCoords(lat, lng) {
		return Result{}, derr.ErrBadRequest
	}
	lang = normLang(lang)
	if s.geo == nil {
		return degraded(), nil
	}
	if !s.server.Allow("places") {
		return Result{}, derr.ErrRateLimited
	}
	p, err := s.geo.Reverse(ctx, lat, lng, lang)
	if err != nil {
		return degraded(), nil
	}
	if p == nil {
		return Result{Results: []models.Place{}}, nil
	}
	ps := []models.Place{*p}
	s.fillTZ(ps)
	return Result{Results: ps}, nil
}
