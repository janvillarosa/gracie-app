package dynamo

import (
    "context"
    "errors"
    "strconv"
    "time"

    "github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
    derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
    "github.com/janvillarosa/gracie-app/backend/internal/models"
)

const itemListIndex = "list_id_index"

type ListItemRepo struct{ c *Client }

func NewListItemRepo(c *Client) *ListItemRepo { return &ListItemRepo{c: c} }

func (r *ListItemRepo) Put(ctx context.Context, it *models.ListItem) error {
    item, err := attributevalue.MarshalMap(it)
    if err != nil { return err }
    _, err = r.c.DB.PutItem(ctx, &dynamodb.PutItemInput{
        TableName:           &r.c.Tables.ListItems,
        Item:                item,
        ConditionExpression: strPtr("attribute_not_exists(item_id)"),
    })
    return err
}

func (r *ListItemRepo) GetByID(ctx context.Context, id string) (*models.ListItem, error) {
    out, err := r.c.DB.GetItem(ctx, &dynamodb.GetItemInput{
        TableName: &r.c.Tables.ListItems,
        Key:       map[string]types.AttributeValue{"item_id": &types.AttributeValueMemberS{Value: id}},
    })
    if err != nil { return nil, err }
    if out.Item == nil || len(out.Item) == 0 { return nil, derr.ErrNotFound }
    var it models.ListItem
    if err := attributevalue.UnmarshalMap(out.Item, &it); err != nil { return nil, err }
    return &it, nil
}

func (r *ListItemRepo) ListByList(ctx context.Context, listID string) ([]models.ListItem, error) {
    out, err := r.c.DB.Query(ctx, &dynamodb.QueryInput{
        TableName:              &r.c.Tables.ListItems,
        IndexName:              strPtr(itemListIndex),
        KeyConditionExpression: strPtr("list_id = :lid"),
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":lid": &types.AttributeValueMemberS{Value: listID},
        },
    })
    if err != nil { return nil, err }
    var items []models.ListItem
    if err := attributevalue.UnmarshalListOfMaps(out.Items, &items); err != nil { return nil, err }
    return items, nil
}

func (r *ListItemRepo) UpdateCompletion(ctx context.Context, itemID string, completed bool, updatedAt time.Time) error {
    _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
        TableName:        &r.c.Tables.ListItems,
        Key:              map[string]types.AttributeValue{"item_id": &types.AttributeValueMemberS{Value: itemID}},
        UpdateExpression: strPtr("SET completed = :c, updated_at = :ua"),
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":c":  &types.AttributeValueMemberBOOL{Value: completed},
            ":ua": &types.AttributeValueMemberS{Value: updatedAt.UTC().Format(time.RFC3339)},
        },
        ConditionExpression: strPtr("attribute_exists(item_id)"),
    })
    return err
}

func (r *ListItemRepo) UpdateDescription(ctx context.Context, itemID, description string, updatedAt time.Time) error {
    _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
        TableName:        &r.c.Tables.ListItems,
        Key:              map[string]types.AttributeValue{"item_id": &types.AttributeValueMemberS{Value: itemID}},
        UpdateExpression: strPtr("SET description = :d, updated_at = :ua"),
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":d":  &types.AttributeValueMemberS{Value: description},
            ":ua": &types.AttributeValueMemberS{Value: updatedAt.UTC().Format(time.RFC3339)},
        },
        ConditionExpression: strPtr("attribute_exists(item_id)"),
    })
    return err
}

func (r *ListItemRepo) UpdateOrder(ctx context.Context, itemID string, order float64, updatedAt time.Time) error {
    _, err := r.c.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
        TableName:        &r.c.Tables.ListItems,
        Key:              map[string]types.AttributeValue{"item_id": &types.AttributeValueMemberS{Value: itemID}},
        UpdateExpression: strPtr("SET #ord = :o, updated_at = :ua"),
        ExpressionAttributeNames: map[string]string{
            "#ord": "order",
        },
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":o":  &types.AttributeValueMemberN{Value: strconv.FormatFloat(order, 'f', -1, 64)},
            ":ua": &types.AttributeValueMemberS{Value: updatedAt.UTC().Format(time.RFC3339)},
        },
        ConditionExpression: strPtr("attribute_exists(item_id)"),
    })
    return err
}


func (r *ListItemRepo) Delete(ctx context.Context, itemID string) error {
    _, err := r.c.DB.DeleteItem(ctx, &dynamodb.DeleteItemInput{
        TableName: &r.c.Tables.ListItems,
        Key:       map[string]types.AttributeValue{"item_id": &types.AttributeValueMemberS{Value: itemID}},
        ConditionExpression: strPtr("attribute_exists(item_id)"),
    })
    if err != nil {
        var cce *types.ConditionalCheckFailedException
        if errors.As(err, &cce) { return derr.ErrNotFound }
        return err
    }
    return nil
}
