package analytics

import "time"

// SetWorkerClock lets the external test package drive the fold clock.
func SetWorkerClock(w *Worker, now func() time.Time) { w.now = now }
