package handlers_test

import (
	"encoding/json"
	"net/http"
	"testing"
)

type roomView struct {
	MembersMeta []struct {
		UserID string `json:"user_id"`
		Name   string `json:"name"`
	} `json:"members_meta"`
}

func (f tripFixture) roomViewFor(t *testing.T, apiKey string) roomView {
	t.Helper()
	g := f
	g.apiKey = apiKey
	rec := g.do(http.MethodGet, "/rooms/me", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /rooms/me: %d %s", rec.Code, rec.Body)
	}
	var v roomView
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func (f tripFixture) newUser(t *testing.T, name string) (apiKey string) {
	t.Helper()
	rec := f.do(http.MethodPost, "/users", `{"name":"`+name+`"}`)
	var out struct {
		APIKey string `json:"api_key"`
	}
	if rec.Code != http.StatusCreated || json.Unmarshal(rec.Body.Bytes(), &out) != nil || out.APIKey == "" {
		t.Fatalf("create user: %d %s", rec.Code, rec.Body)
	}
	return out.APIKey
}

func TestRoomViewMembersMetaIncludesUserIDsOnlyForOwnRoom(t *testing.T) {
	f := newTripFixture(t, nil, nil)
	solo := f.roomViewFor(t, f.apiKey)
	if len(solo.MembersMeta) != 1 || solo.MembersMeta[0].UserID == "" {
		t.Fatalf("member user_id missing: %+v", solo)
	}
	aliceID := solo.MembersMeta[0].UserID

	// an unrelated household never sees Alice's id
	otherKey := f.newUser(t, "Other")
	other := f.roomViewFor(t, otherKey)
	if len(other.MembersMeta) != 1 || other.MembersMeta[0].UserID == "" || other.MembersMeta[0].UserID == aliceID {
		t.Fatalf("other household view leaks or is empty: %+v", other)
	}

	// after joining, members of the shared house see both ids
	rec := f.do(http.MethodPost, "/rooms/share", ``)
	var share struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &share)
	g := f
	g.apiKey = otherKey
	if rec := g.do(http.MethodPost, "/rooms/join", `{"token":"`+share.Token+`"}`); rec.Code != http.StatusOK {
		t.Fatalf("join: %d %s", rec.Code, rec.Body)
	}
	shared := f.roomViewFor(t, f.apiKey)
	ids := map[string]bool{}
	for _, m := range shared.MembersMeta {
		ids[m.UserID] = true
	}
	if len(ids) != 2 || !ids[aliceID] || !ids[other.MembersMeta[0].UserID] {
		t.Fatalf("shared view: %+v", shared)
	}
}
