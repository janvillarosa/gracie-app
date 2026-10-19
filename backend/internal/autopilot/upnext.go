package autopilot

import "github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"

// RouteItem is one live list item that has a spot on the house's route. The view sends every
// such item, checked or not, so the client can move the anchor as things are checked.
type RouteItem struct {
	ItemID string  `json:"item_id"`
	Key    string  `json:"key"`
	Spot   float64 `json:"spot"`
	Done   bool    `json:"done"`
}

// PickUpNext is the pick rule on list items (the frontend's lib/upNext holds the same rule; both
// run testdata/upnext_cases.json). anchorItemID is the last item checked this run that has a
// spot; an empty or unknown anchor is the start of the route. It returns the ids of the item to
// do next and the one after it, each "" when there is none. Look-alike items share a key, so the
// first unchecked item of a key is the one named.
func PickUpNext(route []RouteItem, anchorItemID string) (next, then string) {
	spots := make(map[string]float64, len(route))
	byKey := map[string]string{} // key -> first unchecked item
	var unchecked []string
	anchor := 0.0
	for _, it := range route {
		if _, ok := spots[it.Key]; !ok {
			spots[it.Key] = it.Spot
		}
		if it.ItemID == anchorItemID {
			anchor = it.Spot
		}
		if it.Done {
			continue
		}
		if _, ok := byKey[it.Key]; !ok {
			byKey[it.Key] = it.ItemID
			unchecked = append(unchecked, it.Key)
		}
	}
	nk, tk := predict.PickNext(spots, unchecked, anchor)
	return byKey[nk], byKey[tk]
}
