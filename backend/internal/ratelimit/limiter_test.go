package ratelimit

import (
	"testing"
	"time"
)

func TestBurstThenRefill(t *testing.T) {
	clock := time.Unix(1000, 0)
	l := New(2, 3) // 2 tokens/s, burst 3
	l.now = func() time.Time { return clock }
	for i := 0; i < 3; i++ {
		if !l.Allow("u") {
			t.Fatalf("burst call %d denied", i)
		}
	}
	if l.Allow("u") {
		t.Fatal("4th immediate call should be denied")
	}
	if !l.Allow("other") {
		t.Fatal("keys are independent")
	}
	clock = clock.Add(600 * time.Millisecond) // +1.2 tokens
	if !l.Allow("u") {
		t.Fatal("should have refilled one token")
	}
	if l.Allow("u") {
		t.Fatal("only one token had refilled")
	}
}

func TestIdleBucketsArePruned(t *testing.T) {
	clock := time.Unix(1000, 0)
	l := New(1, 1)
	l.now = func() time.Time { return clock }
	for i := 0; i < maxBuckets+10; i++ {
		l.Allow(string(rune(i + 1)))
	}
	clock = clock.Add(time.Hour)
	l.Allow("fresh")
	if len(l.buckets) > 5 {
		t.Fatalf("idle buckets not pruned: %d", len(l.buckets))
	}
}
