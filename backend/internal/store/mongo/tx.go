package mongo

import (
    "context"
    "strings"

    "github.com/janvillarosa/gracie-app/backend/internal/store"
    mgo "go.mongodb.org/mongo-driver/mongo"
)

type Tx struct{ client *mgo.Client }

func NewTx(c *Client) *Tx { return &Tx{client: c.Client} }

func (t *Tx) WithTransaction(ctx context.Context, fn func(ctx context.Context) error) error {
    sess, err := t.client.StartSession()
    if err != nil {
        // Fallback: run without transaction if sessions/tx unsupported
        return fn(ctx)
    }
    defer sess.EndSession(ctx)
    _, err = sess.WithTransaction(ctx, func(sc mgo.SessionContext) (any, error) {
        return nil, fn(sc)
    })
    if err != nil {
        // Fallback for standalone servers (no replica set)
        if strings.Contains(err.Error(), "Transaction numbers are only allowed") ||
            strings.Contains(err.Error(), "not supported") {
            return fn(ctx)
        }
    }
    return err
}

// Ensure Tx implements store.TxRunner
var _ store.TxRunner = (*Tx)(nil)
