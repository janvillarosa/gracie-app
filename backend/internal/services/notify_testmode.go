package services

import (
	"context"
	"fmt"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/push"
	"github.com/janvillarosa/gracie-app/backend/pkg/ids"
)

// actorTest is the actor of simulated adds. As a system:* actor it matches no person, so the whole
// house, the tester included, hears about them.
const actorTest = "system:test"

// SendTest pushes a sample straight to the user's own devices: no outbox, no switches, nobody else.
// It returns how each of the user's devices took it.
func (s *NotifyService) SendTest(ctx context.Context, u *models.User) ([]DeviceResult, error) {
	subs, err := s.subs.ListByUsers(ctx, []string{u.UserID})
	if err != nil {
		return nil, err
	}
	// The same devices a real notification would reach (the caller is signed in, or it could not ask).
	subs = currentDevices(subs, map[string]*models.User{u.UserID: u})
	msg := push.Message{Title: "Bauhouse", Body: "Test notification: it works.", URL: "/app", Tag: "test:" + u.UserID}
	return s.deliverEach(ctx, subs, msg, push.Topic(ids.NewID("test"))), nil
}

// SimulateAdds queues five adds from a made-up housemate to the house's first list, through the
// real outbox, so the merge window and the wording can be watched. It returns the list's name.
func (s *NotifyService) SimulateAdds(ctx context.Context, u *models.User) (string, error) {
	l, err := s.firstList(ctx, u)
	if err != nil {
		return "", err
	}
	for i := 1; i <= 5; i++ {
		s.ItemAdded(ctx, actorTest, &models.ListItem{RoomID: l.RoomID, ListID: l.ListID, Description: fmt.Sprintf("Test item %d", i)})
	}
	return l.Name, nil
}

// SimulateChecks queues a made-up housemate checking off three items on the house's first list, as
// one run that goes out after the merge window. Each call is its own run, so it works on every tap
// (a real person's run stays quiet for two hours after it starts). It returns the list's name.
func (s *NotifyService) SimulateChecks(ctx context.Context, u *models.User) (string, error) {
	l, err := s.firstList(ctx, u)
	if err != nil {
		return "", err
	}
	now := s.now().UTC()
	j := &models.PushJob{
		CoalesceKey: fmt.Sprintf("test-check:%s:%d", u.UserID, now.UnixNano()), Kind: models.PushKindItemChecks,
		RoomID: l.RoomID, ActorID: actorTest, ListID: l.ListID, URL: "/app/lists/" + l.ListID,
		Names: []string{"Test item 1"}, SendAfter: now.Add(s.coalesce), CreatedAt: now, ExpireAt: now.Add(pushKeep),
	}
	if err := s.jobs.EnqueueRun(ctx, j, checkRunGap, now); err != nil {
		return "", err
	}
	for _, n := range []string{"Test item 2", "Test item 3"} {
		j.Names = []string{n}
		if err := s.jobs.EnqueueRun(ctx, j, checkRunGap, now); err != nil {
			return "", err
		}
	}
	return l.Name, nil
}

// firstList is the caller's house's first live list.
func (s *NotifyService) firstList(ctx context.Context, u *models.User) (*models.List, error) {
	if u.RoomID == nil {
		return nil, derr.ErrBadRequest
	}
	lists, err := s.lists.ListByRoom(ctx, *u.RoomID)
	if err != nil {
		return nil, err
	}
	for i := range lists {
		if !lists[i].IsDeleted {
			return &lists[i], nil
		}
	}
	return nil, fmt.Errorf("the house has no list: %w", derr.ErrBadRequest)
}

// QueueTripSample queues a sample trip reminder for the user alone, due now. It goes through the
// outbox and the user's trip switch like a real reminder.
func (s *NotifyService) QueueTripSample(ctx context.Context, u *models.User) error {
	if u.RoomID == nil {
		return derr.ErrBadRequest
	}
	now := s.now().UTC()
	s.enqueue(ctx, &models.PushJob{
		CoalesceKey: fmt.Sprintf("test-trip:%s:%d", u.UserID, now.UnixNano()), Kind: models.PushKindTrip,
		RoomID: *u.RoomID, Recipients: []string{u.UserID}, URL: "/app", Title: "Lisbon (test)",
		Body: "Tram 28 at 10:30", SendAfter: now,
	}, false)
	return nil
}

// Coalesce is how long adds wait to merge.
func (s *NotifyService) Coalesce() time.Duration { return s.coalesce }
