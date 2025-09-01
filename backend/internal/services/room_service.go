package services

import (
    "context"
    "time"

    "github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
    derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
    "github.com/janvillarosa/gracie-app/backend/internal/models"
    "github.com/janvillarosa/gracie-app/backend/internal/store/dynamo"
    "github.com/janvillarosa/gracie-app/backend/pkg/ids"
)

type RoomService struct {
    ddb   *dynamo.Client
    users *dynamo.UserRepo
    rooms *dynamo.RoomRepo
}

func NewRoomService(ddb *dynamo.Client, users *dynamo.UserRepo, rooms *dynamo.RoomRepo) *RoomService {
    return &RoomService{ddb: ddb, users: users, rooms: rooms}
}

func (s *RoomService) GetMyRoom(ctx context.Context, user *models.User) (*models.Room, error) {
    if user.RoomID == nil || *user.RoomID == "" {
        return nil, derr.ErrNotFound
    }
    return s.rooms.GetByID(ctx, *user.RoomID)
}

func (s *RoomService) CreateSoloRoom(ctx context.Context, user *models.User) (*models.Room, error) {
    if user.RoomID != nil && *user.RoomID != "" {
        return nil, derr.ErrConflict
    }
    now := time.Now().UTC()
    room := &models.Room{
        RoomID:        ids.NewID("room"),
        MemberIDs:     []string{user.UserID},
        DeletionVotes: map[string]string{},
        DisplayName:   "My Room",
        Description:   "",
        CreatedAt:     now,
        UpdatedAt:     now,
    }
    roomItem, err := attributevalue.MarshalMap(room)
    if err != nil {
        return nil, err
    }
    _, err = s.ddb.DB.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
        TransactItems: []types.TransactWriteItem{
            {Put: &types.Put{TableName: &s.ddb.Tables.Rooms, Item: roomItem, ConditionExpression: strPtr("attribute_not_exists(room_id)")}},
            {Update: &types.Update{TableName: &s.ddb.Tables.Users,
                Key: map[string]types.AttributeValue{"user_id": &types.AttributeValueMemberS{Value: user.UserID}},
                UpdateExpression:          strPtr("SET room_id = :rid, updated_at = :ua"),
                ConditionExpression:       strPtr("attribute_not_exists(room_id)"),
                ExpressionAttributeValues: map[string]types.AttributeValue{":rid": &types.AttributeValueMemberS{Value: room.RoomID}, ":ua": &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)}},
            }},
        },
    })
    if err != nil {
        return nil, err
    }
    return room, nil
}

func (s *RoomService) RotateShareToken(ctx context.Context, user *models.User) (string, error) {
    if user.RoomID == nil || *user.RoomID == "" {
        return "", derr.ErrNotFound
    }
    token := ids.NewShareToken5()
    if err := s.rooms.SetShareToken(ctx, *user.RoomID, user.UserID, token, time.Now().UTC()); err != nil {
        return "", err
    }
    return token, nil
}

// JoinRoom joins the authenticated user to the target room using a token.
// - Room must have exactly one member
// - Token must match
// - If the joiner has a solo room, delete it in the same transaction
func (s *RoomService) JoinRoom(ctx context.Context, joiner *models.User, roomID, token string) (*models.Room, error) {
    now := time.Now().UTC()
    // Load the target room to validate token and members
    rm, err := s.rooms.GetByID(ctx, roomID)
    if err != nil {
        return nil, err
    }
    if rm.ShareToken == nil || *rm.ShareToken == "" || token == "" || token != *rm.ShareToken {
        return nil, derr.ErrForbidden
    }
    if len(rm.MemberIDs) != 1 {
        return nil, derr.ErrConflict
    }
    if rm.MemberIDs[0] == joiner.UserID {
        return nil, derr.ErrConflict
    }

    // If joiner has a room, ensure it's a solo room; if 2-person, block.
    var deleteSolo *models.Room
    if joiner.RoomID != nil && *joiner.RoomID != "" {
        jr, err := s.rooms.GetByID(ctx, *joiner.RoomID)
        if err != nil {
            return nil, err
        }
        if len(jr.MemberIDs) > 1 {
            return nil, derr.ErrConflict
        }
        deleteSolo = jr
    }

    // Build transaction: update target room add joiner, remove share_token; update joiner room_id; delete solo room if present
    transact := []types.TransactWriteItem{
        {Update: &types.Update{
            TableName: &s.ddb.Tables.Rooms,
            Key:       map[string]types.AttributeValue{"room_id": &types.AttributeValueMemberS{Value: rm.RoomID}},
            UpdateExpression: strPtr("REMOVE share_token SET member_ids = list_append(member_ids, :j), updated_at = :ua"),
            ConditionExpression: strPtr("size(member_ids) = :one AND share_token = :tok AND NOT contains(member_ids, :uid)"),
            ExpressionAttributeValues: map[string]types.AttributeValue{
                ":j":   &types.AttributeValueMemberL{Value: []types.AttributeValue{&types.AttributeValueMemberS{Value: joiner.UserID}}},
                ":one": &types.AttributeValueMemberN{Value: "1"},
                ":tok": &types.AttributeValueMemberS{Value: token},
                ":uid": &types.AttributeValueMemberS{Value: joiner.UserID},
                ":ua":  &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
            },
        }},
        {Update: &types.Update{
            TableName: &s.ddb.Tables.Users,
            Key:       map[string]types.AttributeValue{"user_id": &types.AttributeValueMemberS{Value: joiner.UserID}},
            UpdateExpression:          strPtr("SET room_id = :rid, updated_at = :ua"),
            ExpressionAttributeValues: map[string]types.AttributeValue{":rid": &types.AttributeValueMemberS{Value: rm.RoomID}, ":ua": &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)}},
        }},
    }
    if deleteSolo != nil {
        transact = append(transact, types.TransactWriteItem{Delete: &types.Delete{
            TableName:           &s.ddb.Tables.Rooms,
            Key:                 map[string]types.AttributeValue{"room_id": &types.AttributeValueMemberS{Value: deleteSolo.RoomID}},
            ConditionExpression: strPtr("size(member_ids) = :one AND contains(member_ids, :uid)"),
            ExpressionAttributeValues: map[string]types.AttributeValue{
                ":one": &types.AttributeValueMemberN{Value: "1"},
                ":uid": &types.AttributeValueMemberS{Value: joiner.UserID},
            },
        }})
    }

    _, err = s.ddb.DB.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: transact})
    if err != nil {
        return nil, err
    }
    // Update joiner's in-memory room reference
    joiner.RoomID = &rm.RoomID
    // Return the updated room (now with two members)
    return s.rooms.GetByID(ctx, rm.RoomID)
}

// JoinRoomByToken joins using only a token by looking up the room via GSI.
func (s *RoomService) JoinRoomByToken(ctx context.Context, joiner *models.User, token string) (*models.Room, error) {
    if token == "" {
        return nil, derr.ErrBadRequest
    }
    rm, err := s.rooms.GetByShareToken(ctx, token)
    if err != nil { return nil, err }
    return s.JoinRoom(ctx, joiner, rm.RoomID, token)
}

func (s *RoomService) VoteDeletion(ctx context.Context, voter *models.User) (deleted bool, err error) {
    if voter.RoomID == nil || *voter.RoomID == "" {
        return false, derr.ErrNotFound
    }
    now := time.Now().UTC()
    if err := s.rooms.VoteDeletion(ctx, *voter.RoomID, voter.UserID, now); err != nil {
        return false, err
    }
    // Fetch to check both votes exist
    rm, err := s.rooms.GetByID(ctx, *voter.RoomID)
    if err != nil {
        return false, err
    }
    // Must have exactly two members and votes from both
    if len(rm.MemberIDs) == 2 {
        v1 := rm.DeletionVotes[rm.MemberIDs[0]]
        v2 := rm.DeletionVotes[rm.MemberIDs[1]]
        if v1 != "" && v2 != "" {
            // finalize delete: delete room and clear both users' room_id atomically
            _, err := s.ddb.DB.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
                TransactItems: []types.TransactWriteItem{
                    {Delete: &types.Delete{
                        TableName:           &s.ddb.Tables.Rooms,
                        Key:                 map[string]types.AttributeValue{"room_id": &types.AttributeValueMemberS{Value: rm.RoomID}},
                        ConditionExpression: strPtr("attribute_exists(room_id) AND attribute_exists(deletion_votes.#u1) AND attribute_exists(deletion_votes.#u2)"),
                        ExpressionAttributeNames: map[string]string{
                            "#u1": rm.MemberIDs[0],
                            "#u2": rm.MemberIDs[1],
                        },
                    }},
                    {Update: &types.Update{TableName: &s.ddb.Tables.Users, Key: map[string]types.AttributeValue{"user_id": &types.AttributeValueMemberS{Value: rm.MemberIDs[0]}}, UpdateExpression: strPtr("REMOVE room_id SET updated_at = :ua"), ExpressionAttributeValues: map[string]types.AttributeValue{":ua": &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)}}}},
                    {Update: &types.Update{TableName: &s.ddb.Tables.Users, Key: map[string]types.AttributeValue{"user_id": &types.AttributeValueMemberS{Value: rm.MemberIDs[1]}}, UpdateExpression: strPtr("REMOVE room_id SET updated_at = :ua"), ExpressionAttributeValues: map[string]types.AttributeValue{":ua": &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)}}}},
                },
            })
            if err != nil {
                return false, err
            }
            return true, nil
        }
    }
    return false, nil
}

func (s *RoomService) CancelDeletionVote(ctx context.Context, user *models.User) error {
    if user.RoomID == nil || *user.RoomID == "" {
        return derr.ErrNotFound
    }
    _, err := s.ddb.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
        TableName: &s.ddb.Tables.Rooms,
        Key:       map[string]types.AttributeValue{"room_id": &types.AttributeValueMemberS{Value: *user.RoomID}},
        UpdateExpression:          strPtr("REMOVE deletion_votes.#u"),
        ExpressionAttributeNames:  map[string]string{"#u": user.UserID},
        ConditionExpression:       strPtr("contains(member_ids, :uid)"),
        ExpressionAttributeValues: map[string]types.AttributeValue{":uid": &types.AttributeValueMemberS{Value: user.UserID}},
    })
    return err
}

func strPtr(s string) *string { return &s }

// UpdateRoomSettings updates display name and/or description for the caller's room.
// Pass empty pointers to skip. Passing a non-nil empty description removes it.
func (s *RoomService) UpdateRoomSettings(ctx context.Context, user *models.User, displayName *string, description *string) error {
    if user.RoomID == nil || *user.RoomID == "" {
        return derr.ErrNotFound
    }
    // Build dynamic update
    now := time.Now().UTC().Format(time.RFC3339)
    setExpr := "updated_at = :ua"
    removeExpr := ""
    eav := map[string]types.AttributeValue{":ua": &types.AttributeValueMemberS{Value: now}, ":uid": &types.AttributeValueMemberS{Value: user.UserID}}
    if displayName != nil {
        setExpr = "display_name = :dn, " + setExpr
        eav[":dn"] = &types.AttributeValueMemberS{Value: *displayName}
    }
    if description != nil {
        if *description == "" {
            removeExpr = " REMOVE description"
        } else {
            setExpr = "description = :desc, " + setExpr
            eav[":desc"] = &types.AttributeValueMemberS{Value: *description}
        }
    }
    updateExpr := "SET " + setExpr + removeExpr
    _, err := s.ddb.DB.UpdateItem(ctx, &dynamodb.UpdateItemInput{
        TableName:                 &s.ddb.Tables.Rooms,
        Key:                       map[string]types.AttributeValue{"room_id": &types.AttributeValueMemberS{Value: *user.RoomID}},
        UpdateExpression:          &updateExpr,
        ConditionExpression:       strPtr("contains(member_ids, :uid)"),
        ExpressionAttributeValues: eav,
    })
    return err
}
