package analytics

import "context"

type ctxKey string

const tzKey ctxKey = "analytics_tz"

// WithTZ stores the request's validated IANA zone for local-time bucketing.
func WithTZ(ctx context.Context, tz string) context.Context {
	return context.WithValue(ctx, tzKey, tz)
}

// TZFrom returns the request zone, or "" (treated as UTC).
func TZFrom(ctx context.Context) string {
	s, _ := ctx.Value(tzKey).(string)
	return s
}
