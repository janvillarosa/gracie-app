package replay_test

import (
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/autopilot"
	"github.com/janvillarosa/gracie-app/backend/internal/autopilot/replay"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/households"
)

func scores(seed int64) map[string]replay.UpNextScore {
	out := map[string]replay.UpNextScore{}
	for _, h := range households.Routes(seed) {
		out[h.Persona] = replay.UpNext(h.Runs, autopilot.DefaultPolicy)
	}
	return out
}

func pooled(s map[string]replay.UpNextScore) (hits, trials int) {
	for _, v := range s {
		hits += v.Hits
		trials += v.Trials
	}
	return
}

func TestUpNextGateOnRoutePersonas(t *testing.T) {
	hits, trials := pooled(scores(1))
	if trials == 0 {
		t.Fatal("it never spoke on any persona")
	}
	if rate := float64(hits) / float64(trials); rate < replay.UpNextHitGate {
		t.Errorf("pooled hit rate %.3f (%d/%d), want >= %.2f", rate, hits, trials, replay.UpNextHitGate)
	}
}

func TestUpNextSilentWhenInconsistent(t *testing.T) {
	s := scores(1)
	for _, persona := range []string{"two_stores", "random", "top_ups"} {
		if s[persona].Spoke != 0 {
			t.Errorf("%s: spoke on %d runs, want silence: %+v", persona, s[persona].Spoke, s[persona])
		}
	}
}

func TestUpNextSpeaksForSteady(t *testing.T) {
	st := scores(1)["steady"]
	eligible := st.Runs - 5 // the route needs five runs behind it
	if eligible <= 0 || st.Spoke*2 < eligible {
		t.Errorf("steady spoke on %d of %d eligible runs, want at least half: %+v", st.Spoke, eligible, st)
	}
}

func TestUpNextHoldOutSeeds(t *testing.T) {
	for seed := int64(2); seed <= 6; seed++ {
		hits, trials := pooled(scores(seed))
		if trials == 0 {
			t.Fatalf("seed %d: never spoke", seed)
		}
		if rate := float64(hits) / float64(trials); rate < replay.UpNextHitGate {
			t.Errorf("seed %d: pooled hit rate %.3f (%d/%d), want >= %.2f", seed, rate, hits, trials, replay.UpNextHitGate)
		}
		for _, persona := range []string{"two_stores", "random", "top_ups"} {
			if s := scores(seed)[persona]; s.Spoke != 0 {
				t.Errorf("seed %d %s: spoke on %d runs, want silence", seed, persona, s.Spoke)
			}
		}
	}
}
