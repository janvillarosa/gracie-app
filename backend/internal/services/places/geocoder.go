// Package places proxies place search to a Photon-compatible geocoder with caching,
// rate limiting and graceful degradation.
package places

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

const maxUpstreamBytes = 256 << 10

type Geocoder interface {
	Search(ctx context.Context, q string, lat, lng *float64, lang string, limit int) ([]models.Place, error)
	Reverse(ctx context.Context, lat, lng float64, lang string) (*models.Place, error)
}

// Photon talks to a Photon-compatible API at a fixed, operator-configured base URL.
type Photon struct {
	base      string
	userAgent string
	timeout   time.Duration
	client    *http.Client
}

func NewPhoton(baseURL, userAgent string, timeout time.Duration, client *http.Client) *Photon {
	if client == nil {
		client = &http.Client{}
	}
	return &Photon{base: strings.TrimRight(baseURL, "/"), userAgent: userAgent, timeout: timeout, client: client}
}

type photonResp struct {
	Features []struct {
		Geometry struct {
			Coordinates []float64 `json:"coordinates"` // [lng, lat]
		} `json:"geometry"`
		Properties struct {
			Name        string `json:"name"`
			Street      string `json:"street"`
			HouseNumber string `json:"housenumber"`
			City        string `json:"city"`
			State       string `json:"state"`
			Country     string `json:"country"`
			OSMID       int64  `json:"osm_id"`
			OSMType     string `json:"osm_type"`
		} `json:"properties"`
	} `json:"features"`
}

func (p *Photon) get(ctx context.Context, path string, q url.Values) (*photonResp, error) {
	ctx, cancel := context.WithTimeout(ctx, p.timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.base+path+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", p.userAgent)
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("photon: status %d", resp.StatusCode)
	}
	var out photonResp
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxUpstreamBytes)).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

func toPlaces(r *photonResp, source string) []models.Place {
	out := make([]models.Place, 0, len(r.Features))
	for _, f := range r.Features {
		if len(f.Geometry.Coordinates) != 2 || f.Properties.Name == "" {
			continue
		}
		pr := f.Properties
		var parts []string
		for _, s := range []string{strings.TrimSpace(pr.Street + " " + pr.HouseNumber), pr.City, pr.State, pr.Country} {
			if s != "" {
				parts = append(parts, s)
			}
		}
		pl := models.Place{Name: pr.Name, Address: strings.Join(parts, ", "), Lng: f.Geometry.Coordinates[0], Lat: f.Geometry.Coordinates[1], Source: source}
		if pr.OSMType != "" && pr.OSMID != 0 {
			pl.OSMRef = fmt.Sprintf("%s%d", pr.OSMType, pr.OSMID)
		}
		out = append(out, pl)
	}
	return out
}

func (p *Photon) Search(ctx context.Context, q string, lat, lng *float64, lang string, limit int) ([]models.Place, error) {
	v := url.Values{}
	v.Set("q", q)
	v.Set("lang", lang)
	v.Set("limit", fmt.Sprint(limit))
	if lat != nil && lng != nil {
		v.Set("lat", fmt.Sprintf("%.1f", *lat)) // rounded bias, never exact coordinates
		v.Set("lon", fmt.Sprintf("%.1f", *lng))
	}
	r, err := p.get(ctx, "/api", v)
	if err != nil {
		return nil, err
	}
	return toPlaces(r, "photon"), nil
}

func (p *Photon) Reverse(ctx context.Context, lat, lng float64, lang string) (*models.Place, error) {
	v := url.Values{}
	v.Set("lat", fmt.Sprintf("%.5f", lat))
	v.Set("lon", fmt.Sprintf("%.5f", lng))
	v.Set("lang", lang)
	r, err := p.get(ctx, "/reverse", v)
	if err != nil {
		return nil, err
	}
	ps := toPlaces(r, "pin")
	if len(ps) == 0 {
		return nil, nil
	}
	return &ps[0], nil
}
