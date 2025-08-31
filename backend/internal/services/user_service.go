package services

import (
	"context"
	"time"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	authpkg "github.com/janvillarosa/gracie-app/backend/internal/auth"
	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/store/dynamo"
	"github.com/janvillarosa/gracie-app/backend/pkg/ids"
)

type UserService struct {
	ddb   *dynamo.Client
	users *dynamo.UserRepo
}

func NewUserService(ddb *dynamo.Client, users *dynamo.UserRepo) *UserService {
	return &UserService{ddb: ddb, users: users}
}

type CreatedUser struct {
	User   *models.User
	APIKey string
}

func (s *UserService) CreateUserWithSoloRoom(ctx context.Context, name string) (*CreatedUser, error) {
	now := time.Now().UTC()

	userID := ids.NewID("usr")
	roomID := ids.NewID("room")

	apiKey, apiHash, err := authpkg.GenerateAPIKey()
	if err != nil {
		return nil, err
	}
	lookup := authpkg.DeriveLookup(apiKey)

	user := &models.User{
		UserID:       userID,
		Name:         name,
		APIKeyHash:   apiHash,
		APIKeyLookup: lookup,
		RoomID:       &roomID,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	room := &models.Room{
		RoomID:        roomID,
		MemberIDs:     []string{userID},
		DeletionVotes: map[string]string{},
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	userItem, err := attributevalue.MarshalMap(user)
	if err != nil {
		return nil, err
	}
	roomItem, err := attributevalue.MarshalMap(room)
	if err != nil {
		return nil, err
	}

	_, err = s.ddb.DB.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{Put: &types.Put{
				TableName:           &s.ddb.Tables.Users,
				Item:                userItem,
				ConditionExpression: strPtr("attribute_not_exists(user_id)"),
			}},
			{Put: &types.Put{
				TableName:           &s.ddb.Tables.Rooms,
				Item:                roomItem,
				ConditionExpression: strPtr("attribute_not_exists(room_id)"),
			}},
		},
	})
	if err != nil {
		return nil, err
	}
	return &CreatedUser{User: user, APIKey: apiKey}, nil
}

func (s *UserService) GetMe(ctx context.Context, userID string) (*models.User, error) {
	return s.users.GetByID(ctx, userID)
}

func (s *UserService) UpdateName(ctx context.Context, userID string, name string) error {
	if name == "" {
		return derr.ErrBadRequest
	}
	return s.users.UpdateName(ctx, userID, name, time.Now().UTC())
}
