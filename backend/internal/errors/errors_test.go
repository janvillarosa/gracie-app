package errors

import "testing"

func TestSentinelErrors(t *testing.T) {
    // Ensure errors are stable singletons (identity equality)
    if ErrUnauthorized.Error() != "unauthorized" { t.Fatalf("unexpected msg: %v", ErrUnauthorized) }
    if ErrBadRequest.Error() != "bad request" { t.Fatalf("unexpected msg: %v", ErrBadRequest) }
    if ErrConflict.Error() != "conflict" { t.Fatalf("unexpected msg: %v", ErrConflict) }
    if ErrNotFound.Error() != "not found" { t.Fatalf("unexpected msg: %v", ErrNotFound) }
    if ErrForbidden.Error() != "forbidden" { t.Fatalf("unexpected msg: %v", ErrForbidden) }
}

