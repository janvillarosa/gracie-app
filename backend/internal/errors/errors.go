package errors

import "errors"

var (
    ErrUnauthorized       = errors.New("unauthorized")
    ErrBadRequest         = errors.New("bad request")
    ErrConflict           = errors.New("conflict")
    ErrNotFound           = errors.New("not found")
    ErrForbidden          = errors.New("forbidden")
)

