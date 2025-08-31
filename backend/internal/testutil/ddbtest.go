package testutil

import (
    "context"
    "crypto/rand"
    "encoding/hex"
    "errors"
    "os"
    "testing"
    "time"

    "github.com/aws/aws-sdk-go-v2/aws"
    awsconfig "github.com/aws/aws-sdk-go-v2/config"
    "github.com/aws/aws-sdk-go-v2/credentials"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

const apiKeyLookupIndex = "api_key_lookup_index"

// SetupDynamoOrSkip creates ephemeral Users/Rooms tables for tests.
// It returns a configured dynamo client and a cleanup function to drop tables.
func SetupDynamoOrSkip(t *testing.T) (db *dynamodb.Client, usersTable, roomsTable string, cleanup func()) {
    t.Helper()

    endpoint := getenv("DDB_ENDPOINT", "http://localhost:8000")
    region := getenv("AWS_REGION", "us-east-1")

    // Random suffix to avoid collisions between tests
    suffix := randHex(6)
    usersTable = "Users_test_" + suffix
    roomsTable = "Rooms_test_" + suffix

    ctx := context.Background()
    cfg, err := awsconfig.LoadDefaultConfig(ctx,
        awsconfig.WithRegion(region),
        awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider("local", "local", "")),
        awsconfig.WithEndpointResolverWithOptions(aws.EndpointResolverWithOptionsFunc(
            func(service, region string, options ...interface{}) (aws.Endpoint, error) {
                return aws.Endpoint{URL: endpoint, HostnameImmutable: true, PartitionID: "aws"}, nil
            },
        )))
    if err != nil { t.Skipf("config: %v", err) }
    client := dynamodb.NewFromConfig(cfg)

    // Probe connectivity quickly; if fail, skip
    if _, err := client.ListTables(ctx, &dynamodb.ListTablesInput{Limit: int32Ptr(1)}); err != nil {
        t.Skipf("skipping: cannot reach DynamoDB at %s: %v", endpoint, err)
    }

    // Create tables
    if err := ensureUsersTable(ctx, client, usersTable); err != nil {
        // If endpoint is up but cannot create tables, skip to avoid false failures
        t.Skipf("cannot create users table: %v", err)
    }
    if err := ensureRoomsTable(ctx, client, roomsTable); err != nil {
        t.Skipf("cannot create rooms table: %v", err)
    }

    cleanup = func() {
        // Best-effort deletes; DDB Local removes immediately
        _, _ = client.DeleteTable(ctx, &dynamodb.DeleteTableInput{TableName: &usersTable})
        _, _ = client.DeleteTable(ctx, &dynamodb.DeleteTableInput{TableName: &roomsTable})
    }
    return client, usersTable, roomsTable, cleanup
}

func ensureUsersTable(ctx context.Context, db *dynamodb.Client, table string) error {
    if _, err := db.DescribeTable(ctx, &dynamodb.DescribeTableInput{TableName: &table}); err == nil {
        return ensureUsersGSI(ctx, db, table)
    } else if !isNotFound(err) {
        return err
    }
    _, err := db.CreateTable(ctx, &dynamodb.CreateTableInput{
        TableName: &table,
        AttributeDefinitions: []types.AttributeDefinition{
            {AttributeName: strPtr("user_id"), AttributeType: types.ScalarAttributeTypeS},
            {AttributeName: strPtr("api_key_lookup"), AttributeType: types.ScalarAttributeTypeS},
        },
        KeySchema:  []types.KeySchemaElement{{AttributeName: strPtr("user_id"), KeyType: types.KeyTypeHash}},
        BillingMode: types.BillingModePayPerRequest,
        GlobalSecondaryIndexes: []types.GlobalSecondaryIndex{{
            IndexName: strPtr(apiKeyLookupIndex),
            KeySchema: []types.KeySchemaElement{{AttributeName: strPtr("api_key_lookup"), KeyType: types.KeyTypeHash}},
            Projection: &types.Projection{ProjectionType: types.ProjectionTypeAll},
        }},
    })
    if err != nil {
        return err
    }
    // Wait until active (DDB Local is fast, but be safe)
    waiter := dynamodb.NewTableExistsWaiter(db)
    return waiter.Wait(ctx, &dynamodb.DescribeTableInput{TableName: &table}, 20*time.Second)
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
    return err
}

func ensureRoomsTable(ctx context.Context, db *dynamodb.Client, table string) error {
    if _, err := db.DescribeTable(ctx, &dynamodb.DescribeTableInput{TableName: &table}); err == nil {
        return nil
    } else if !isNotFound(err) {
        return err
    }
    _, err := db.CreateTable(ctx, &dynamodb.CreateTableInput{
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
    return waiter.Wait(ctx, &dynamodb.DescribeTableInput{TableName: &table}, 20*time.Second)
}

func isNotFound(err error) bool {
    var rnfe *types.ResourceNotFoundException
    return errors.As(err, &rnfe)
}

func randHex(n int) string {
    b := make([]byte, n)
    _, _ = rand.Read(b)
    return hex.EncodeToString(b)
}

func getenv(k, def string) string {
    if v := os.Getenv(k); v != "" {
        return v
    }
    return def
}

func int32Ptr(v int32) *int32 { return &v }
func strPtr(s string) *string { return &s }
