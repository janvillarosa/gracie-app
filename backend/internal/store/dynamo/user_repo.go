package dynamo

import (
    "context"
    "errors"
    "time"

    "github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
    derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
    "github.com/janvillarosa/gracie-app/backend/internal/models"
)

const apiKeyLookupIndex = "api_key_lookup_index"
const usernameIndex = "username_index"

type UserRepo struct {
    c *Client
}

func NewUserRepo(c *Client) *UserRepo { return &UserRepo{c: c} }

func (r *UserRepo) Put(ctx context.Context, u *models.User) error {
    item, err := attributevalue.MarshalMap(u)
    if err != nil {
        return err
    }
    _, err = r.c.DB.PutItem(ctx, &dynamodb.PutItemInput{
        TableName:           &r.c.Tables.Users,
        Item:                item,
        ConditionExpression: strPtr("attribute_not_exists(user_id)"),
    })
    return err
}

func (r *UserRepo) GetByID(ctx context.Context, id string) (*models.User, error) {
    out, err := r.c.DB.GetItem(ctx, &dynamodb.GetItemInput{
        TableName: &r.c.Tables.Users,
        Key: map[string]types.AttributeValue{
            "user_id": &types.AttributeValueMemberS{Value: id},
        },
    })
    if err != nil {
        return nil, err
    }
    if out.Item == nil || len(out.Item) == 0 {
        return nil, derr.ErrNotFound
    }
    var u models.User
    if err := attributevalue.UnmarshalMap(out.Item, &u); err != nil {
        return nil, err
    }
    return &u, nil
}

func (r *UserRepo) GetByAPIKeyLookup(ctx context.Context, lookup string) (*models.User, error) {
    out, err := r.c.DB.Query(ctx, &dynamodb.QueryInput{
        TableName:              &r.c.Tables.Users,
        IndexName:              strPtr(apiKeyLookupIndex),
        KeyConditionExpression: strPtr("api_key_lookup = :v"),
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":v": &types.AttributeValueMemberS{Value: lookup},
        },
        Limit: int32Ptr(1),
    })
    if err != nil {
        return nil, err
    }
    if out.Count == 0 || len(out.Items) == 0 {
        return nil, derr.ErrUnauthorized
    }
    var u models.User
    if err := attributevalue.UnmarshalMap(out.Items[0], &u); err != nil {
        return nil, err
    }
    return &u, nil
}

func (r *UserRepo) GetByUsername(ctx context.Context, username string) (*models.User, error) {
    out, err := r.c.DB.Query(ctx, &dynamodb.QueryInput{
        TableName:              &r.c.Tables.Users,
        IndexName:              strPtr(usernameIndex),
        KeyConditionExpression: strPtr("username = :u"),
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":u": &types.AttributeValueMemberS{Value: username},
        },
        Limit: int32Ptr(1),
    })
    if err != nil {
        return nil, err
    }
    if out.Count == 0 || len(out.Items) == 0 {
        return nil, derr.ErrNotFound
    }
    var u models.User
    if err := attributevalue.UnmarshalMap(out.Items[0], &u); err != nil {
        return nil, err
    }
    return &u, nil
}

func (r *UserRepo) SetAPIKey(ctx context.Context, userID string, hash, lookup string, updatedAt time.Time) error {
    _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
        TableName:        &r.c.Tables.Users,
        Key:              map[string]types.AttributeValue{"user_id": &types.AttributeValueMemberS{Value: userID}},
        UpdateExpression: strPtr("SET api_key_hash = :h, api_key_lookup = :l, updated_at = :ua"),
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":h":  &types.AttributeValueMemberS{Value: hash},
            ":l":  &types.AttributeValueMemberS{Value: lookup},
            ":ua": &types.AttributeValueMemberS{Value: updatedAt.UTC().Format(time.RFC3339)},
        },
        ReturnValues: types.ReturnValueNone,
    })
    return err
}

func (r *UserRepo) SetPasswordEnc(ctx context.Context, userID string, enc string, updatedAt time.Time) error {
    _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
        TableName:        &r.c.Tables.Users,
        Key:              map[string]types.AttributeValue{"user_id": &types.AttributeValueMemberS{Value: userID}},
        UpdateExpression: strPtr("SET password_enc = :p, updated_at = :ua"),
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":p":  &types.AttributeValueMemberS{Value: enc},
            ":ua": &types.AttributeValueMemberS{Value: updatedAt.UTC().Format(time.RFC3339)},
        },
    })
    return err
}

func (r *UserRepo) UpdateName(ctx context.Context, userID string, name string, updatedAt time.Time) error {
    _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
        TableName:        &r.c.Tables.Users,
        Key:              map[string]types.AttributeValue{"user_id": &types.AttributeValueMemberS{Value: userID}},
        UpdateExpression: strPtr("SET #n = :name, updated_at = :ua"),
        ExpressionAttributeNames: map[string]string{
            "#n": "name",
        },
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":name": &types.AttributeValueMemberS{Value: name},
            ":ua":   &types.AttributeValueMemberS{Value: updatedAt.UTC().Format(time.RFC3339)},
        },
        ReturnValues: types.ReturnValueNone,
    })
    return err
}

func (r *UserRepo) SetRoomID(ctx context.Context, userID string, roomID string, updatedAt time.Time) error {
    _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
        TableName:        &r.c.Tables.Users,
        Key:              map[string]types.AttributeValue{"user_id": &types.AttributeValueMemberS{Value: userID}},
        UpdateExpression: strPtr("SET room_id = :rid, updated_at = :ua"),
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":rid": &types.AttributeValueMemberS{Value: roomID},
            ":ua":  &types.AttributeValueMemberS{Value: updatedAt.UTC().Format(time.RFC3339)},
        },
    })
    return err
}

func (r *UserRepo) ClearRoomID(ctx context.Context, userID string, updatedAt time.Time) error {
    _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
        TableName:        &r.c.Tables.Users,
        Key:              map[string]types.AttributeValue{"user_id": &types.AttributeValueMemberS{Value: userID}},
        UpdateExpression: strPtr("REMOVE room_id SET updated_at = :ua"),
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":ua": &types.AttributeValueMemberS{Value: updatedAt.UTC().Format(time.RFC3339)},
        },
    })
    var cce *types.ConditionalCheckFailedException
    if err != nil && errors.As(err, &cce) {
        return derr.ErrConflict
    }
    return err
}

func strPtr(s string) *string { return &s }
func int32Ptr(n int32) *int32 { return &n }
