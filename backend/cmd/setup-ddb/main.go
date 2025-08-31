package main

import (
    "context"
    "errors"
    "log"
    "time"

    "github.com/aws/aws-sdk-go-v2/service/dynamodb"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
    "github.com/janvillarosa/gracie-app/backend/internal/config"
    "github.com/janvillarosa/gracie-app/backend/internal/store/dynamo"
)

const apiKeyLookupIndex = "api_key_lookup_index"

func main() {
    ctx := context.Background()

    cfg, err := config.Load()
    if err != nil {
        log.Fatalf("config: %v", err)
    }

    client, err := dynamo.New(ctx, cfg.AWSRegion, cfg.DDBEndpoint, dynamo.Tables{Users: cfg.UsersTable, Rooms: cfg.RoomsTable})
    if err != nil {
        log.Fatalf("dynamo client: %v", err)
    }

    if err := ensureUsersTable(ctx, client.DB, cfg.UsersTable); err != nil {
        log.Fatalf("ensure users table: %v", err)
    }
    if err := ensureRoomsTable(ctx, client.DB, cfg.RoomsTable); err != nil {
        log.Fatalf("ensure rooms table: %v", err)
    }
    log.Println("DynamoDB tables are ready ✅")
}

func ensureUsersTable(ctx context.Context, db *dynamodb.Client, table string) error {
    // Describe
    _, err := db.DescribeTable(ctx, &dynamodb.DescribeTableInput{TableName: &table})
    if err == nil {
        log.Printf("table %s exists", table)
        // ensure GSI
        return ensureUsersGSI(ctx, db, table)
    }
    if err != nil && !isNotFound(err) {
        return err
    }
    // Create
    log.Printf("creating table %s...", table)
    _, err = db.CreateTable(ctx, &dynamodb.CreateTableInput{
        TableName: &table,
        AttributeDefinitions: []types.AttributeDefinition{
            {AttributeName: strPtr("user_id"), AttributeType: types.ScalarAttributeTypeS},
            {AttributeName: strPtr("api_key_lookup"), AttributeType: types.ScalarAttributeTypeS},
        },
        KeySchema: []types.KeySchemaElement{{AttributeName: strPtr("user_id"), KeyType: types.KeyTypeHash}},
        BillingMode: types.BillingModePayPerRequest,
        GlobalSecondaryIndexes: []types.GlobalSecondaryIndex{
            {
                IndexName: strPtr(apiKeyLookupIndex),
                KeySchema: []types.KeySchemaElement{{AttributeName: strPtr("api_key_lookup"), KeyType: types.KeyTypeHash}},
                Projection: &types.Projection{ProjectionType: types.ProjectionTypeAll},
            },
        },
    })
    if err != nil {
        return err
    }
    waiter := dynamodb.NewTableExistsWaiter(db)
    if err := waiter.Wait(ctx, &dynamodb.DescribeTableInput{TableName: &table}, 30*time.Second); err != nil {
        return err
    }
    log.Printf("created table %s", table)
    return nil
}

func ensureUsersGSI(ctx context.Context, db *dynamodb.Client, table string) error {
    out, err := db.DescribeTable(ctx, &dynamodb.DescribeTableInput{TableName: &table})
    if err != nil {
        return err
    }
    for _, g := range out.Table.GlobalSecondaryIndexes {
        if g.IndexName != nil && *g.IndexName == apiKeyLookupIndex {
            return nil
        }
    }
    log.Printf("adding GSI %s to %s...", apiKeyLookupIndex, table)
    _, err = db.UpdateTable(ctx, &dynamodb.UpdateTableInput{
        TableName: &table,
        GlobalSecondaryIndexUpdates: []types.GlobalSecondaryIndexUpdate{
            {Create: &types.CreateGlobalSecondaryIndexAction{
                IndexName: strPtr(apiKeyLookupIndex),
                KeySchema: []types.KeySchemaElement{{AttributeName: strPtr("api_key_lookup"), KeyType: types.KeyTypeHash}},
                Projection: &types.Projection{ProjectionType: types.ProjectionTypeAll},
            }},
        },
    })
    if err != nil {
        return err
    }
    // Wait until GSI becomes active (best-effort; DDB Local is usually immediate)
    time.Sleep(2 * time.Second)
    log.Printf("added GSI %s", apiKeyLookupIndex)
    return nil
}

func ensureRoomsTable(ctx context.Context, db *dynamodb.Client, table string) error {
    // Describe
    _, err := db.DescribeTable(ctx, &dynamodb.DescribeTableInput{TableName: &table})
    if err == nil {
        log.Printf("table %s exists", table)
        return nil
    }
    if err != nil && !isNotFound(err) {
        return err
    }
    log.Printf("creating table %s...", table)
    _, err = db.CreateTable(ctx, &dynamodb.CreateTableInput{
        TableName: &table,
        AttributeDefinitions: []types.AttributeDefinition{
            {AttributeName: strPtr("room_id"), AttributeType: types.ScalarAttributeTypeS},
        },
        KeySchema:  []types.KeySchemaElement{{AttributeName: strPtr("room_id"), KeyType: types.KeyTypeHash}},
        BillingMode: types.BillingModePayPerRequest,
    })
    if err != nil {
        return err
    }
    waiter := dynamodb.NewTableExistsWaiter(db)
    if err := waiter.Wait(ctx, &dynamodb.DescribeTableInput{TableName: &table}, 30*time.Second); err != nil {
        return err
    }
    log.Printf("created table %s", table)
    return nil
}

func strPtr(s string) *string { return &s }

func isNotFound(err error) bool {
    var rnfe *types.ResourceNotFoundException
    return errors.As(err, &rnfe)
}
