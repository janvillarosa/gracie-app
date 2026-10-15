// Package ratelimit is a small in-process token-bucket limiter keyed by string.
package ratelimit

import (
	"math"
	"sync"
	"time"
)

const (
	maxBuckets = 10000
	idleAfter  = 10 * time.Minute
)

type bucket struct {
	tokens float64
	last   time.Time
}

type Limiter struct {
	mu      sync.Mutex
	rate    float64
	burst   float64
	buckets map[string]*bucket
	now     func() time.Time
}

// Burst returns a bucket size of four seconds of traffic, never below one token
// (a rate under 1/s would otherwise truncate to a bucket that rejects everything).
func Burst(ratePerSec float64) int {
	return int(math.Max(1, math.Ceil(ratePerSec*4)))
}

func New(ratePerSec float64, burst int) *Limiter {
	return &Limiter{rate: ratePerSec, burst: float64(burst), buckets: map[string]*bucket{}, now: time.Now}
}

// Allow consumes one token for key and reports whether the call may proceed.
func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if len(l.buckets) > maxBuckets {
		for k, b := range l.buckets {
			if now.Sub(b.last) > idleAfter {
				delete(l.buckets, k)
			}
		}
	}
	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	b.tokens += now.Sub(b.last).Seconds() * l.rate
	if b.tokens > l.burst {
		b.tokens = l.burst
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}
