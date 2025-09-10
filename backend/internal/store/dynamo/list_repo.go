package dynamo

import (
    "context"
    "errors"
    "fmt"
    "time"

    "github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
    derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
    "github.com/janvillarosa/gracie-app/backend/internal/models"
)

const listRoomIndex = "room_id_index"

type ListRepo struct{ c *Client }

func NewListRepo(c *Client) *ListRepo { return &ListRepo{c: c} }

func (r *ListRepo) Put(ctx context.Context, l *models.List) error {
    item, err := attributevalue.MarshalMap(l)
    if err != nil { return err }
    _, err = r.c.DB.PutItem(ctx, &dynamodb.PutItemInput{
        TableName:           &r.c.Tables.Lists,
        Item:                item,
        ConditionExpression: strPtr("attribute_not_exists(list_id)"),
    })
    return err
}

func (r *ListRepo) GetByID(ctx context.Context, id string) (*models.List, error) {
    out, err := r.c.DB.GetItem(ctx, &dynamodb.GetItemInput{
        TableName: &r.c.Tables.Lists,
        Key:       map[string]types.AttributeValue{"list_id": &types.AttributeValueMemberS{Value: id}},
    })
    if err != nil { return nil, err }
    if out.Item == nil || len(out.Item) == 0 { return nil, derr.ErrNotFound }
    var l models.List
    if err := attributevalue.UnmarshalMap(out.Item, &l); err != nil { return nil, err }
    return &l, nil
}

func (r *ListRepo) ListByRoom(ctx context.Context, roomID string) ([]models.List, error) {
    out, err := r.c.DB.Query(ctx, &dynamodb.QueryInput{
        TableName:              &r.c.Tables.Lists,
        IndexName:              strPtr(listRoomIndex),
        KeyConditionExpression: strPtr("room_id = :rid"),
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":rid": &types.AttributeValueMemberS{Value: roomID},
        },
    })
    if err != nil { return nil, err }
    var lists []models.List
    if err := attributevalue.UnmarshalListOfMaps(out.Items, &lists); err != nil { return nil, err }
    // Filter out soft-deleted
    filtered := make([]models.List, 0, len(lists))
    for _, l := range lists {
        if !l.IsDeleted {
            filtered = append(filtered, l)
        }
    }
    return filtered, nil
}

// ListByRoomRaw returns all lists for a room, including soft-deleted ones.
func (r *ListRepo) ListByRoomRaw(ctx context.Context, roomID string) ([]models.List, error) {
    out, err := r.c.DB.Query(ctx, &dynamodb.QueryInput{
        TableName:              &r.c.Tables.Lists,
        IndexName:              strPtr(listRoomIndex),
        KeyConditionExpression: strPtr("room_id = :rid"),
        ExpressionAttributeValues: map[string]types.AttributeValue{":rid": &types.AttributeValueMemberS{Value: roomID}},
    })
    if err != nil { return nil, err }
    var lists []models.List
    if err := attributevalue.UnmarshalListOfMaps(out.Items, &lists); err != nil { return nil, err }
    return lists, nil
}

func (r *ListRepo) AddDeletionVote(ctx context.Context, listID, userID string, ts time.Time) error {
    _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
        TableName:        &r.c.Tables.Lists,
        Key:              map[string]types.AttributeValue{"list_id": &types.AttributeValueMemberS{Value: listID}},
        UpdateExpression: strPtr("SET deletion_votes.#u = :ts, updated_at = :ua"),
        ExpressionAttributeNames: map[string]string{"#u": userID},
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":ts": &types.AttributeValueMemberS{Value: ts.UTC().Format(time.RFC3339)},
            ":ua": &types.AttributeValueMemberS{Value: ts.UTC().Format(time.RFC3339)},
        },
        ConditionExpression: strPtr("attribute_exists(list_id) AND attribute_not_exists(is_deleted)"),
    })
    return err
}

func (r *ListRepo) RemoveDeletionVote(ctx context.Context, listID, userID string) error {
    _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
        TableName:        &r.c.Tables.Lists,
        Key:              map[string]types.AttributeValue{"list_id": &types.AttributeValueMemberS{Value: listID}},
        UpdateExpression: strPtr("REMOVE deletion_votes.#u SET updated_at = :ua"),
        ExpressionAttributeNames: map[string]string{"#u": userID},
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":ua": &types.AttributeValueMemberS{Value: time.Now().UTC().Format(time.RFC3339)},
        },
        ConditionExpression: strPtr("attribute_exists(list_id) AND attribute_not_exists(is_deleted)"),
    })
    return err
}

func (r *ListRepo) UpdateName(ctx context.Context, listID string, name string, updatedAt time.Time) error {
    _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
        TableName:        &r.c.Tables.Lists,
        Key:              map[string]types.AttributeValue{"list_id": &types.AttributeValueMemberS{Value: listID}},
        UpdateExpression: strPtr("SET #n = :nv, updated_at = :ua"),
        ExpressionAttributeNames: map[string]string{"#n": "name"},
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":nv": &types.AttributeValueMemberS{Value: name},
            ":ua": &types.AttributeValueMemberS{Value: updatedAt.UTC().Format(time.RFC3339)},
        },
        ConditionExpression: strPtr("attribute_exists(list_id) AND attribute_not_exists(is_deleted)"),
    })
    return err
}

func (r *ListRepo) UpdateDescription(ctx context.Context, listID string, description string, updatedAt time.Time) error {
    if description == "" {
        _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
            TableName:        &r.c.Tables.Lists,
            Key:              map[string]types.AttributeValue{"list_id": &types.AttributeValueMemberS{Value: listID}},
            UpdateExpression: strPtr("REMOVE description SET updated_at = :ua"),
            ExpressionAttributeValues: map[string]types.AttributeValue{
                ":ua": &types.AttributeValueMemberS{Value: updatedAt.UTC().Format(time.RFC3339)},
            },
            ConditionExpression: strPtr("attribute_exists(list_id) AND attribute_not_exists(is_deleted)"),
        })
        return err
    }
    _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
        TableName:        &r.c.Tables.Lists,
        Key:              map[string]types.AttributeValue{"list_id": &types.AttributeValueMemberS{Value: listID}},
        UpdateExpression: strPtr("SET description = :dv, updated_at = :ua"),
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":dv": &types.AttributeValueMemberS{Value: description},
            ":ua": &types.AttributeValueMemberS{Value: updatedAt.UTC().Format(time.RFC3339)},
        },
        ConditionExpression: strPtr("attribute_exists(list_id) AND attribute_not_exists(is_deleted)"),
    })
    return err
}

func (r *ListRepo) UpdateNotes(ctx context.Context, listID string, notes string, updatedAt time.Time) error {
    if notes == "" {
        _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
            TableName:        &r.c.Tables.Lists,
            Key:              map[string]types.AttributeValue{"list_id": &types.AttributeValueMemberS{Value: listID}},
            UpdateExpression: strPtr("REMOVE notes SET updated_at = :ua"),
            ExpressionAttributeValues: map[string]types.AttributeValue{
                ":ua": &types.AttributeValueMemberS{Value: updatedAt.UTC().Format(time.RFC3339)},
            },
            ConditionExpression: strPtr("attribute_exists(list_id) AND attribute_not_exists(is_deleted)"),
        })
        return err
    }
    _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
        TableName:        &r.c.Tables.Lists,
        Key:              map[string]types.AttributeValue{"list_id": &types.AttributeValueMemberS{Value: listID}},
        UpdateExpression: strPtr("SET notes = :nv, updated_at = :ua"),
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":nv": &types.AttributeValueMemberS{Value: notes},
            ":ua": &types.AttributeValueMemberS{Value: updatedAt.UTC().Format(time.RFC3339)},
        },
        ConditionExpression: strPtr("attribute_exists(list_id) AND attribute_not_exists(is_deleted)"),
    })
    return err
}

func (r *ListRepo) UpdateIcon(ctx context.Context, listID string, icon string, updatedAt time.Time) error {
    if icon == "" {
        _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
            TableName:        &r.c.Tables.Lists,
            Key:              map[string]types.AttributeValue{"list_id": &types.AttributeValueMemberS{Value: listID}},
            UpdateExpression: strPtr("REMOVE icon SET updated_at = :ua"),
            ExpressionAttributeValues: map[string]types.AttributeValue{
                ":ua": &types.AttributeValueMemberS{Value: updatedAt.UTC().Format(time.RFC3339)},
            },
            ConditionExpression: strPtr("attribute_exists(list_id) AND attribute_not_exists(is_deleted)"),
        })
        return err
    }
    _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
        TableName:        &r.c.Tables.Lists,
        Key:              map[string]types.AttributeValue{"list_id": &types.AttributeValueMemberS{Value: listID}},
        UpdateExpression: strPtr("SET icon = :iv, updated_at = :ua"),
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":iv": &types.AttributeValueMemberS{Value: icon},
            ":ua": &types.AttributeValueMemberS{Value: updatedAt.UTC().Format(time.RFC3339)},
        },
        ConditionExpression: strPtr("attribute_exists(list_id) AND attribute_not_exists(is_deleted)"),
    })
    return err
}

// FinalizeDeleteIfVotedByAll sets is_deleted=true when votes exist for all memberIDs passed.
func (r *ListRepo) FinalizeDeleteIfVotedByAll(ctx context.Context, listID string, memberIDs []string, ts time.Time) (bool, error) {
    // Build dynamic ConditionExpression requiring all deletion_votes for memberIDs
    names := map[string]string{}
    cond := "attribute_not_exists(is_deleted)"
    for i, uid := range memberIDs {
        key := fmt.Sprintf("#u%d", i)
        names[key] = uid
        cond = fmt.Sprintf("%s AND attribute_exists(deletion_votes.%s)", cond, key)
    }
    _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
        TableName:        &r.c.Tables.Lists,
        Key:              map[string]types.AttributeValue{"list_id": &types.AttributeValueMemberS{Value: listID}},
        UpdateExpression: strPtr("SET is_deleted = :true, updated_at = :ua"),
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":true": &types.AttributeValueMemberBOOL{Value: true},
            ":ua":   &types.AttributeValueMemberS{Value: ts.UTC().Format(time.RFC3339)},
        },
        ExpressionAttributeNames: names,
        ConditionExpression:      &cond,
        ReturnValues:             types.ReturnValueNone,
    })
    if err != nil {
        var cce *types.ConditionalCheckFailedException
        if errors.As(err, &cce) { return false, nil }
        return false, err
    }
    return true, nil
}

func (r *ListRepo) Delete(ctx context.Context, listID string) error {
    _, err := r.c.DB.DeleteItem(ctx, &dynamodb.DeleteItemInput{
        TableName: &r.c.Tables.Lists,
        Key:       map[string]types.AttributeValue{"list_id": &types.AttributeValueMemberS{Value: listID}},
        ConditionExpression: strPtr("attribute_exists(list_id)"),
    })
    return err
}
