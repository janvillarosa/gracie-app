package services

import (
	"context"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
)

// InsightsService serves the precomputed analytics to members. Everything here is a read
// of an aggregate; no endpoint exposes raw events.
type InsightsService struct {
	rooms  store.RoomRepository
	reader *analytics.Reader
	now    func() time.Time
}

func NewInsightsService(rooms store.RoomRepository, reader *analytics.Reader) *InsightsService {
	return &InsightsService{rooms: rooms, reader: reader, now: time.Now}
}

// MyInsights is the caller's own profile (nudges stay personal); Profile is nil until one exists.
func (s *InsightsService) MyInsights(ctx context.Context, user *models.User) (*analytics.Profile, error) {
	return s.reader.Profile(ctx, user.UserID)
}

// HouseInsights is the house profile plus the things predicted to be needed within `within`.
type HouseInsights struct {
	Profile *analytics.Profile  `json:"profile"`
	Due     []analytics.KeyStat `json:"due"`
}

func (s *InsightsService) HouseInsights(ctx context.Context, user *models.User, roomID, subjectType string, within time.Duration, limit int) (*HouseInsights, error) {
	if err := ensureRoomMembership(ctx, s.rooms, user, roomID); err != nil {
		return nil, err
	}
	profile, err := s.reader.HouseProfile(ctx, roomID)
	if err != nil {
		return nil, err
	}
	due, err := s.reader.Due(ctx, roomID, subjectType, s.now().UTC().Add(within), limit)
	if err != nil {
		return nil, err
	}
	for i := range due {
		due[i].ByActor = nil // a nudge is about the house's rhythm, not who usually does it
	}
	if due == nil {
		due = []analytics.KeyStat{}
	}
	return &HouseInsights{Profile: profile, Due: due}, nil
}

// HousePeriod is the house's rolled-up counts for a day, month or year, including each member's
// own totals (the house review can say "Sam checked off 312 items").
func (s *InsightsService) HousePeriod(ctx context.Context, user *models.User, roomID, period string) (map[string]any, error) {
	if err := ensureRoomMembership(ctx, s.rooms, user, roomID); err != nil {
		return nil, err
	}
	if !analytics.ValidPeriod(period) {
		return nil, derr.ErrBadRequest
	}
	doc, err := s.reader.Period(ctx, "h", roomID, period)
	if err != nil {
		return nil, err
	}
	if doc == nil {
		doc = map[string]any{}
	}
	delete(doc, "_id")
	return doc, nil
}
