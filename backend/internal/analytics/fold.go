package analytics

import "strings"

// pathSafe makes arbitrary text usable as one segment of a Mongo field path.
func pathSafe(s string) string {
	if s == "" {
		return "_"
	}
	return strings.NewReplacer(".", "_", "$", "_").Replace(s)
}

func isRealUser(actor string) bool {
	return actor != "" && !strings.HasPrefix(actor, "system:")
}

// periodsOf returns the day, month and year labels for a local date (2026-10-16).
func periodsOf(date string) []string {
	if len(date) != 10 {
		return nil
	}
	return []string{date, date[:7], date[:4]}
}

// Fold turns events into the increments they imply. It is pure: no I/O, and the same
// events always give the same batch. Events whose name is unregistered, or marked Skip,
// are ignored here but remain in the raw store.
func Fold(reg *Registry, events []Event) *Batch {
	b := NewBatch()
	for _, e := range events {
		def, ok := reg.Resolve(e.Name)
		if !ok || def.Skip {
			continue
		}
		if def.RequeueRoom {
			if e.RoomID != "" {
				b.Requeue[e.RoomID] = struct{}{}
				b.Dirty["h:"+e.RoomID] = struct{}{} // the house's run rhythm is measured in home time too
			}
			continue
		}
		st := SubjectType(def.Name)
		verb := strings.TrimPrefix(def.Name, st+".")
		path := st + "." + verb
		periods := periodsOf(e.Local.Date)
		if len(periods) == 0 {
			continue
		}

		type scope struct {
			prefix, id string
			house      bool
		}
		var scopes []scope
		if isRealUser(e.ActorID) {
			scopes = append(scopes, scope{"u", e.ActorID, false})
			b.Dirty["u:"+e.ActorID] = struct{}{}
		}
		if e.RoomID != "" {
			scopes = append(scopes, scope{"h", e.RoomID, true})
			b.Dirty["h:"+e.RoomID] = struct{}{}
		}

		for _, sc := range scopes {
			for i, p := range periods {
				u := b.period(sc.prefix + ":" + sc.id + ":" + p)
				u.Set["scope"], u.Set["owner"], u.Set["period"] = sc.prefix, sc.id, p
				u.Inc["counts."+path]++
				if e.Category != "" {
					u.Inc["by_category."+st+"."+pathSafe(e.Category)]++
				}
				if e.Container != nil {
					u.Inc["containers."+pathSafe(e.Container.Type)+":"+pathSafe(e.Container.ID)+"."+path]++
				}
				if sc.house && isRealUser(e.ActorID) {
					u.Inc["members."+pathSafe(e.ActorID)+"."+path]++
				}
				if i == 0 && e.Key != "" { // per-day counts; months and years are closed from these
					u.Inc["key_counts."+st+"."+pathSafe(e.Key)]++
				}
				switch i {
				case 1:
					b.period(sc.prefix + ":" + sc.id + ":" + p).Set["days."+periods[0]] = true
				case 2:
					b.period(sc.prefix + ":" + sc.id + ":" + p).Set["months."+periods[1]] = true
				}
			}
		}

		// People an event is about (assignees, mentions) get "targeted" counts of their own.
		for _, t := range e.Targets {
			if !isRealUser(t) {
				continue
			}
			b.Dirty["u:"+t] = struct{}{}
			for _, p := range periods {
				u := b.period("u:" + t + ":" + p)
				u.Set["scope"], u.Set["owner"], u.Set["period"] = "u", t, p
				u.Inc["targeted."+path]++
			}
		}

		if e.Key != "" && e.RoomID != "" {
			ref := KeyRef{RoomID: e.RoomID, SubjectType: st, Key: e.Key}
			u := b.key(ref.ID())
			b.Touched[ref.ID()] = ref
			u.Set["room_id"], u.Set["subject_type"], u.Set["key"] = ref.RoomID, ref.SubjectType, ref.Key
			u.Inc["counts."+verb]++
			u.Min["first_at"] = minTime(u.Min["first_at"], e.OccurredAt)
			u.Max["last_at."+verb] = maxTime(u.Max["last_at."+verb], e.OccurredAt)
			if e.Category != "" {
				u.Set["category"] = e.Category
			}
			if isRealUser(e.ActorID) {
				u.Inc["by_actor."+pathSafe(e.ActorID)+"."+verb]++
			}
			if e.Container != nil {
				u.Inc["containers."+pathSafe(e.Container.Type)+":"+pathSafe(e.Container.ID)]++
			}
		}
	}
	return b
}
