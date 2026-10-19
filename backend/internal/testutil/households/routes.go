package households

import (
	"math/rand"
	"slices"
)

// RouteHouse is one made-up house's shopping runs on one list: each run is the keys in the order
// they were checked off, oldest run first. The golden world checks items in random minute offsets,
// so it has no route to learn; these personas do (or deliberately do not), and they use their own
// random source, so the golden world's bytes never move.
type RouteHouse struct {
	Persona string
	Runs    [][]string
}

// store is a made-up shop: the order a house walks it, aisle by aisle.
var store = []string{
	"bananas", "apples", "lettuce", "tomatoes", "onions", "bread", "eggs", "milk", "yogurt",
	"cheese", "chicken", "rice", "pasta", "coffee", "juice", "soap",
}

// Routes builds the route personas for a seed; the same seed always gives the same houses.
//
//	steady        one store, the same walk each run, with small slips between neighbours
//	habit_change  the walk changes halfway (the store was rearranged)
//	two_stores    alternates between two stores whose aisles run opposite ways
//	random        no habit: every run is its own order
//	two_members   two people shop with different walks, one more often than the other
//	top_ups       only ever a few things at a time
func Routes(seed int64) []RouteHouse {
	r := func(i int64) *rand.Rand { return rand.New(rand.NewSource(seed*1000 + i*7919)) }
	const runs = 24
	reversed := slices.Clone(store)
	slices.Reverse(reversed)
	rearranged := shuffled(r(11), store)

	out := []RouteHouse{{Persona: "steady"}, {Persona: "habit_change"}, {Persona: "two_stores"},
		{Persona: "random"}, {Persona: "two_members"}, {Persona: "top_ups"}}
	rs := r(1)
	for i := 0; i < runs; i++ {
		out[0].Runs = append(out[0].Runs, slip(rs, basket(rs, store, 9, 13)))
		walk := store
		if i >= runs/2 {
			walk = rearranged
		}
		out[1].Runs = append(out[1].Runs, slip(rs, basket(rs, walk, 9, 13)))
		walk = store
		if i%2 == 1 {
			walk = reversed
		}
		out[2].Runs = append(out[2].Runs, basket(rs, walk, 9, 13))
		out[3].Runs = append(out[3].Runs, shuffled(rs, basket(rs, store, 9, 13)))
		walk = store
		if rs.Float64() < 0.3 {
			walk = rearranged
		}
		out[4].Runs = append(out[4].Runs, slip(rs, basket(rs, walk, 9, 13)))
		out[5].Runs = append(out[5].Runs, basket(rs, store, 2, 3))
	}
	return out
}

// basket picks between lo and hi things from the walk, keeping the walk's order.
func basket(rng *rand.Rand, walk []string, lo, hi int) []string {
	n := lo + rng.Intn(hi-lo+1)
	pick := rng.Perm(len(walk))[:n]
	slices.Sort(pick)
	out := make([]string, n)
	for i, p := range pick {
		out[i] = walk[p]
	}
	return out
}

// slip swaps a neighbouring pair now and then: a person never walks the shop exactly the same.
func slip(rng *rand.Rand, run []string) []string {
	run = slices.Clone(run)
	for i := 0; i+1 < len(run); i++ {
		if rng.Float64() < 0.08 {
			run[i], run[i+1] = run[i+1], run[i]
			i++
		}
	}
	return run
}

func shuffled(rng *rand.Rand, in []string) []string {
	out := slices.Clone(in)
	rng.Shuffle(len(out), func(i, j int) { out[i], out[j] = out[j], out[i] })
	return out
}
