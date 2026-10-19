package services

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/autopilot"
	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
)

// ErrNeedsTestHouse is returned for an action that reaches housemates when a member of the house
// is not a test account: test mode never acts on real people.
var ErrNeedsTestHouse = errors.New("this action reaches your housemates, and not every member of your house is a test account")

// TestAction is one switch in test mode: it runs a real flow of the app as the test account, so a
// feature can be tried in production. Run returns the line shown under the button.
type TestAction struct {
	ID          string
	Label       string
	Description string
	// TouchesHouse marks an action that can reach other members; it runs only when every member
	// of the caller's house is a test account.
	TouchesHouse bool
	Run          func(ctx context.Context, u *models.User) (string, error)
}

// TestActionInfo is what the app is told about an action.
type TestActionInfo struct {
	ID           string `json:"id"`
	Label        string `json:"label"`
	Description  string `json:"description"`
	TouchesHouse bool   `json:"touches_house"`
}

// TestModeService runs the actions a test account may trigger. Only accounts flagged by the
// operator command (cmd/testaccount) can list or run anything: for everyone else it answers
// not found, as if test mode did not exist. To add a switch, register a TestAction.
type TestModeService struct {
	users   store.UserRepository
	rooms   store.RoomRepository
	actions []TestAction
}

func NewTestModeService(users store.UserRepository, rooms store.RoomRepository) *TestModeService {
	return &TestModeService{users: users, rooms: rooms}
}

// Add registers an action.
func (s *TestModeService) Add(a TestAction) { s.actions = append(s.actions, a) }

// List returns the actions, or derr.ErrNotFound unless u is a test account.
func (s *TestModeService) List(u *models.User) ([]TestActionInfo, error) {
	if !u.TestAccount {
		return nil, derr.ErrNotFound
	}
	out := make([]TestActionInfo, 0, len(s.actions))
	for _, a := range s.actions {
		out = append(out, TestActionInfo{ID: a.ID, Label: a.Label, Description: a.Description, TouchesHouse: a.TouchesHouse})
	}
	return out, nil
}

// Run runs one action as u and returns its result line. Every run is logged.
func (s *TestModeService) Run(ctx context.Context, u *models.User, id string) (string, error) {
	if !u.TestAccount {
		return "", derr.ErrNotFound
	}
	for _, a := range s.actions {
		if a.ID != id {
			continue
		}
		if a.TouchesHouse {
			if err := s.requireTestHouse(ctx, u); err != nil {
				log.Printf("testmode: %s refused %s: %v", u.UserID, id, err)
				return "", err
			}
		}
		msg, err := a.Run(ctx, u)
		log.Printf("testmode: %s ran %s: %q err=%v", u.UserID, id, msg, err)
		return msg, err
	}
	return "", derr.ErrNotFound
}

func (s *TestModeService) requireTestHouse(ctx context.Context, u *models.User) error {
	if u.RoomID == nil {
		return derr.ErrBadRequest
	}
	room, err := s.rooms.GetByID(ctx, *u.RoomID)
	if err != nil {
		return err
	}
	for _, id := range room.MemberIDs {
		m, err := s.users.GetByID(ctx, id)
		if err != nil {
			return err
		}
		if !m.TestAccount {
			return ErrNeedsTestHouse
		}
	}
	return nil
}

// UseNotify registers the push actions.
func (s *TestModeService) UseNotify(n *NotifyService) {
	s.Add(TestAction{
		ID: "push.test", Label: "Send me a test push",
		Description: "Pushes a sample notification to your own devices right now.",
		Run: func(ctx context.Context, u *models.User) (string, error) {
			results, err := n.SendTest(ctx, u)
			if err != nil {
				return "", err
			}
			if len(results) == 0 {
				return "You have no devices yet. Turn on notifications on this phone first.", nil
			}
			sent, notes := 0, make([]string, 0, len(results))
			for _, r := range results {
				if r.ok() {
					sent++
				} else {
					notes = append(notes, r.Describe())
				}
			}
			msg := fmt.Sprintf("Sent to %d of %d devices.", sent, len(results))
			if len(notes) > 0 {
				msg += " " + strings.Join(notes, "; ") + "."
			}
			return msg, nil
		},
	})
	s.Add(TestAction{
		ID: "push.burst", Label: "Simulate five adds", TouchesHouse: true,
		Description: "A made-up housemate adds five items to your first list, through the real outbox. One merged notification should arrive after the merge window.",
		Run: func(ctx context.Context, u *models.User) (string, error) {
			list, err := n.SimulateAdds(ctx, u)
			if err != nil {
				return "", err
			}
			return fmt.Sprintf("Queued five adds to %q. They go out as one notification in about %s.", list, n.Coalesce().Round(time.Second)), nil
		},
	})
	s.Add(TestAction{
		ID: "push.trip", Label: "Queue a trip reminder",
		Description: "Queues a sample trip reminder for you alone. It follows your trip reminders switch and goes out with the next dispatch.",
		Run: func(ctx context.Context, u *models.User) (string, error) {
			if err := n.QueueTripSample(ctx, u); err != nil {
				return "", err
			}
			return "Queued. Run the dispatcher to send it now.", nil
		},
	})
	s.Add(TestAction{
		ID: "push.dispatch", Label: "Run the dispatcher now",
		Description: "Sends every notification that is due, without waiting for the next 15-second pass.",
		Run: func(ctx context.Context, _ *models.User) (string, error) {
			sent, err := n.DispatchOnce(ctx)
			if err != nil {
				return "", err
			}
			return fmt.Sprintf("Sent %d.", sent), nil
		},
	})
}

// UseAutopilot registers the autopilot actions.
func (s *TestModeService) UseAutopilot(a *AutopilotService) {
	s.Add(TestAction{
		ID: "autopilot.tick", Label: "Run autopilot for my house", TouchesHouse: true,
		Description: "Runs one assist pass for your house now, as the 15-minute ticker would.",
		Run: func(ctx context.Context, u *models.User) (string, error) {
			if u.RoomID == nil {
				return "", derr.ErrBadRequest
			}
			room, err := s.rooms.GetByID(ctx, *u.RoomID)
			if err != nil {
				return "", err
			}
			if houseMode(room) != autopilot.ModeAssist {
				return "Your house is not on assist mode, so autopilot adds nothing.", nil
			}
			n, err := a.TickRoom(ctx, room.RoomID)
			if errors.Is(err, ErrAutopilotUnavailable) {
				return "Autopilot is not running on this server (analytics is off).", nil
			}
			if err != nil {
				return "", err
			}
			if n == 0 {
				return "Nothing to add right now.", nil
			}
			return fmt.Sprintf("Added %d items.", n), nil
		},
	})
}
