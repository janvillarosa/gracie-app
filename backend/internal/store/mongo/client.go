package mongo

import (
    "context"
    "time"

    "go.mongodb.org/mongo-driver/mongo"
    "go.mongodb.org/mongo-driver/mongo/options"
)

type Client struct {
    Client *mongo.Client
    DB     *mongo.Database
}

func New(ctx context.Context, uri, dbName string) (*Client, error) {
    cli, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
    if err != nil { return nil, err }
    // Small ping with timeout
    pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    if err := cli.Ping(pingCtx, nil); err != nil { return nil, err }
    return &Client{Client: cli, DB: cli.Database(dbName)}, nil
}

func (c *Client) Close(ctx context.Context) error {
    return c.Client.Disconnect(ctx)
}
