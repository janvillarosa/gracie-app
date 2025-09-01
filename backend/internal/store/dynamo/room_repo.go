package dynamo

import (
    "context"
    "time"

    "github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
    derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
    "github.com/janvillarosa/gracie-app/backend/internal/models"
)

type RoomRepo struct {
    c *Client
}

func NewRoomRepo(c *Client) *RoomRepo { return &RoomRepo{c: c} }

func (r *RoomRepo) Put(ctx context.Context, room *models.Room) error {
    item, err := attributevalue.MarshalMap(room)
    if err != nil {
        return err
    }
    _, err = r.c.DB.PutItem(ctx, &dynamodb.PutItemInput{
        TableName:           &r.c.Tables.Rooms,
        Item:                item,
        ConditionExpression: strPtr("attribute_not_exists(room_id)"),
    })
    return err
}

func (r *RoomRepo) GetByID(ctx context.Context, id string) (*models.Room, error) {
    out, err := r.c.DB.GetItem(ctx, &dynamodb.GetItemInput{
        TableName: &r.c.Tables.Rooms,
        Key: map[string]types.AttributeValue{
            "room_id": &types.AttributeValueMemberS{Value: id},
        },
    })
    if err != nil {
        return nil, err
    }
    if out.Item == nil || len(out.Item) == 0 {
        return nil, derr.ErrNotFound
    }
    var rm models.Room
    if err := attributevalue.UnmarshalMap(out.Item, &rm); err != nil {
        return nil, err
    }
    return &rm, nil
}

func (r *RoomRepo) GetByShareToken(ctx context.Context, token string) (*models.Room, error) {
    idx := "share_token_index"
    out, err := r.c.DB.Query(ctx, &dynamodb.QueryInput{
        TableName:              &r.c.Tables.Rooms,
        IndexName:              &idx,
        KeyConditionExpression: strPtr("share_token = :t"),
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":t": &types.AttributeValueMemberS{Value: token},
        },
        Limit: int32Ptr(1),
    })
    if err != nil {
        return nil, err
    }
    if out.Count == 0 || len(out.Items) == 0 {
        return nil, derr.ErrNotFound
    }
    var rm models.Room
    if err := attributevalue.UnmarshalMap(out.Items[0], &rm); err != nil {
        return nil, err
    }
    return &rm, nil
}

func (r *RoomRepo) SetShareToken(ctx context.Context, roomID string, userID string, token string, updatedAt time.Time) error {
    _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
        TableName:        &r.c.Tables.Rooms,
        Key:              map[string]types.AttributeValue{"room_id": &types.AttributeValueMemberS{Value: roomID}},
        UpdateExpression: strPtr("SET share_token = :tok, updated_at = :ua"),
        ConditionExpression: strPtr("contains(member_ids, :uid)"),
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":tok": &types.AttributeValueMemberS{Value: token},
            ":ua":  &types.AttributeValueMemberS{Value: updatedAt.UTC().Format(time.RFC3339)},
            ":uid": &types.AttributeValueMemberS{Value: userID},
        },
    })
    return err
}

func (r *RoomRepo) RemoveShareToken(ctx context.Context, roomID string, updatedAt time.Time) error {
    _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
        TableName:        &r.c.Tables.Rooms,
        Key:              map[string]types.AttributeValue{"room_id": &types.AttributeValueMemberS{Value: roomID}},
        UpdateExpression: strPtr("REMOVE share_token SET updated_at = :ua"),
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":ua": &types.AttributeValueMemberS{Value: updatedAt.UTC().Format(time.RFC3339)},
        },
    })
    return err
}

func (r *RoomRepo) VoteDeletion(ctx context.Context, roomID string, userID string, ts time.Time) error {
    _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
        TableName:        &r.c.Tables.Rooms,
        Key:              map[string]types.AttributeValue{"room_id": &types.AttributeValueMemberS{Value: roomID}},
        UpdateExpression: strPtr("SET deletion_votes.#u = :ts, updated_at = :ua"),
        ExpressionAttributeNames: map[string]string{
            "#u": userID,
        },
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":ts": &types.AttributeValueMemberS{Value: ts.UTC().Format(time.RFC3339)},
            ":ua": &types.AttributeValueMemberS{Value: ts.UTC().Format(time.RFC3339)},
            ":uid": &types.AttributeValueMemberS{Value: userID},
        },
        ConditionExpression: strPtr("attribute_exists(room_id) AND contains(member_ids, :uid)"),
    })
    return err
}

func (r *RoomRepo) UpdateDescription(ctx context.Context, roomID string, userID string, description string, updatedAt time.Time) error {
    if description == "" {
        _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
            TableName:        &r.c.Tables.Rooms,
            Key:              map[string]types.AttributeValue{"room_id": &types.AttributeValueMemberS{Value: roomID}},
            UpdateExpression: strPtr("REMOVE description SET updated_at = :ua"),
            ExpressionAttributeValues: map[string]types.AttributeValue{
                ":ua":  &types.AttributeValueMemberS{Value: updatedAt.UTC().Format(time.RFC3339)},
                ":uid": &types.AttributeValueMemberS{Value: userID},
            },
            ConditionExpression: strPtr("contains(member_ids, :uid)"),
        })
        return err
    }
    _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
        TableName:        &r.c.Tables.Rooms,
        Key:              map[string]types.AttributeValue{"room_id": &types.AttributeValueMemberS{Value: roomID}},
        UpdateExpression: strPtr("SET description = :d, updated_at = :ua"),
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":d":   &types.AttributeValueMemberS{Value: description},
            ":ua":  &types.AttributeValueMemberS{Value: updatedAt.UTC().Format(time.RFC3339)},
            ":uid": &types.AttributeValueMemberS{Value: userID},
        },
        ConditionExpression: strPtr("contains(member_ids, :uid)"),
    })
    return err
}

func (r *RoomRepo) UpdateDisplayName(ctx context.Context, roomID string, userID string, displayName string, updatedAt time.Time) error {
    _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
        TableName:        &r.c.Tables.Rooms,
        Key:              map[string]types.AttributeValue{"room_id": &types.AttributeValueMemberS{Value: roomID}},
        UpdateExpression: strPtr("SET display_name = :n, updated_at = :ua"),
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":n":   &types.AttributeValueMemberS{Value: displayName},
            ":ua":  &types.AttributeValueMemberS{Value: updatedAt.UTC().Format(time.RFC3339)},
            ":uid": &types.AttributeValueMemberS{Value: userID},
        },
        ConditionExpression: strPtr("contains(member_ids, :uid)"),
    })
    return err
}
