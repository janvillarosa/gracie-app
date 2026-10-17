package services

import (
	"context"
	"errors"
	"log"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/autopilot"
	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/parse"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
	"github.com/janvillarosa/gracie-app/backend/pkg/ids"
)

const (
	// ActorAutopilot is the actor of everything autopilot does. As a system:* actor it never
	// counts as a person (no profile, no turns, not "who did it last").
	ActorAutopilot = "system:autopilot"
	// SourceAutopilot marks list items autopilot added (ListItem.Source).
	SourceAutopilot = "autopilot"
)

// ErrExternalEffect is returned for any effect outside Bauhouse. Buying, booking or messaging on
// a house's behalf needs a new mode and the house's explicit consent; until then it is refused.
var ErrExternalEffect = errors.New("autopilot: effects outside Bauhouse are not allowed")

// UseExecutor gives the service what applying needs: the action log and the list service that
// creates items. Without it the service only proposes.
func (s *AutopilotService) UseExecutor(actions store.AutopilotActionRepository, lists *ListService) {
	s.actions, s.listSvc = actions, lists
}

// Apply carries out one proposal. The action row is written first: its unique key (house, kind,
// key, cycle) makes a second attempt, from a retry or another instance, a no-op (nil, nil). Only
// then is the item created; if that fails the row is removed so a later tick may try again.
func (s *AutopilotService) Apply(ctx context.Context, roomID string, pr autopilot.Proposal) (*models.AutopilotAction, error) {
	switch pr.Effect {
	case autopilot.EffectAddToList:
	default:
		// Every effect must be in-app and reversible; anything else needs a new mode and consent.
		return nil, ErrExternalEffect
	}
	if s.actions == nil || s.listSvc == nil {
		return nil, errors.New("autopilot: no executor configured")
	}
	a := &models.AutopilotAction{
		ActionID: ids.NewID("act"), RoomID: roomID, ListID: pr.ListID, Kind: string(pr.Kind), Key: pr.Key, Cycle: pr.Cycle,
		State: models.ActionApplied, Confidence: pr.Confidence,
		Reason: models.AutopilotReason{Code: pr.Reason.Code, Params: pr.Reason.Params},
		RunAt:  pr.RunAt.UTC(), CreatedAt: s.now().UTC(),
	}
	if err := s.actions.Insert(ctx, a); err != nil {
		if errors.Is(err, derr.ErrConflict) {
			return nil, nil
		}
		return nil, err
	}
	it, err := s.listSvc.CreateSystemItem(ctx, ActorAutopilot, SourceAutopilot, roomID, pr.ListID, pr.Display, pr.Quantity, pr.Unit, pr.Category)
	if err != nil {
		if derr := s.actions.Delete(ctx, a.ActionID); derr != nil {
			log.Printf("autopilot: roll back action %s: %v", a.ActionID, derr)
		}
		return nil, err
	}
	if err := s.actions.SetItem(ctx, a.ActionID, it.ItemID); err != nil {
		return nil, err
	}
	a.ItemID = it.ItemID
	return a, nil
}

// ItemChecked records that an autopilot item was wanted.
func (s *AutopilotService) ItemChecked(ctx context.Context, _ string, it *models.ListItem) {
	if it.Source != SourceAutopilot || s.actions == nil {
		return
	}
	a, err := s.actions.GetByItem(ctx, it.ItemID)
	if err != nil {
		return
	}
	if _, err := s.actions.Resolve(ctx, a.ActionID, []string{models.ActionApplied}, models.ActionConfirmed, s.now().UTC()); err != nil {
		log.Printf("autopilot: confirm %s: %v", a.ActionID, err)
	}
}

// ItemDeleted records that a person removed an autopilot item before it was bought: a miss that
// counts against the forecast. Deleting one already checked off (tidying up) is not.
func (s *AutopilotService) ItemDeleted(ctx context.Context, actorID string, it *models.ListItem) {
	if it.Source != SourceAutopilot || s.actions == nil {
		return
	}
	a, err := s.actions.GetByItem(ctx, it.ItemID)
	if err != nil {
		return
	}
	s.resolveMiss(ctx, a, actorID, models.ActionRemoved, "delete")
}

// resolveMiss moves an applied action to removed or undone and, only if it moved, records the
// dismiss (so an undo racing a delete is counted once).
func (s *AutopilotService) resolveMiss(ctx context.Context, a *models.AutopilotAction, actorID, to, via string) bool {
	ok, err := s.actions.Resolve(ctx, a.ActionID, []string{models.ActionApplied}, to, s.now().UTC())
	if err != nil {
		log.Printf("autopilot: resolve %s: %v", a.ActionID, err)
		return false
	}
	if !ok {
		return false
	}
	s.emit(ctx, analytics.Event{
		Name: "item.autopilot_removed", ActorID: actorID, RoomID: a.RoomID,
		Subject: analytics.Ref{Type: "item", ID: a.ItemID}, Container: ref(listRef(a.ListID)),
		Key: parse.NormalizeKey(a.Key), Props: map[string]any{"via": via},
	})
	return true
}
