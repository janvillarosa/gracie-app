package services

import (
    "context"
    "regexp"
    "time"

    "github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb"
    apiauth "github.com/janvillarosa/gracie-app/backend/internal/auth"
    "github.com/janvillarosa/gracie-app/backend/internal/crypto"
    derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
    "github.com/janvillarosa/gracie-app/backend/internal/models"
    "github.com/janvillarosa/gracie-app/backend/internal/store/dynamo"
    "github.com/janvillarosa/gracie-app/backend/pkg/ids"
    "golang.org/x/crypto/bcrypt"
)

var emailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

type AuthService struct {
    ddb   *dynamo.Client
    users *dynamo.UserRepo
    key   []byte
}

func NewAuthService(ddb *dynamo.Client, users *dynamo.UserRepo, encKeyPath string) (*AuthService, error) {
    key, err := crypto.LoadOrCreateKey(encKeyPath)
    if err != nil { return nil, err }
    return &AuthService{ddb: ddb, users: users, key: key}, nil
}

func (s *AuthService) Register(ctx context.Context, username, password, name string) error {
    if !emailRe.MatchString(username) || len(password) < 8 {
        return derr.ErrBadRequest
    }
    now := time.Now().UTC()
    // Ensure username uniqueness (best-effort via GSI query)
    if _, err := s.users.GetByUsername(ctx, username); err == nil {
        return derr.ErrConflict
    }
    userID := ids.NewID("usr")
    // Hash password with bcrypt, then encrypt the hash at-rest
    ph, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
    if err != nil { return err }
    enc, err := crypto.Encrypt(s.key, ph)
    if err != nil { return err }
    user := &models.User{
        UserID:      userID,
        Name:        name,
        Username:    username,
        PasswordEnc: enc,
        CreatedAt:   now,
        UpdatedAt:   now,
    }
    item, err := attributevalue.MarshalMap(user)
    if err != nil { return err }
    _, err = s.ddb.DB.PutItem(ctx, &dynamodb.PutItemInput{
        TableName:           &s.ddb.Tables.Users,
        Item:                item,
        ConditionExpression: strPtr("attribute_not_exists(user_id)"),
    })
    return err
}

type LoginResult struct {
    User   *models.User
    APIKey string
}

func (s *AuthService) Login(ctx context.Context, username, password string) (*LoginResult, error) {
    u, err := s.users.GetByUsername(ctx, username)
    if err != nil { return nil, derr.ErrUnauthorized }
    if u.PasswordEnc == "" {
        return nil, derr.ErrUnauthorized
    }
    // Decrypt stored bcrypt hash
    ph, err := crypto.Decrypt(s.key, u.PasswordEnc)
    if err != nil { return nil, derr.ErrUnauthorized }
    if bcrypt.CompareHashAndPassword(ph, []byte(password)) != nil {
        return nil, derr.ErrUnauthorized
    }
    // Rotate API key and return plain to client
    plain, hash, err := apiauth.GenerateAPIKey()
    if err != nil { return nil, err }
    lookup := apiauth.DeriveLookup(plain)
    if err := s.users.SetAPIKey(ctx, u.UserID, hash, lookup, time.Now().UTC()); err != nil {
        return nil, err
    }
    return &LoginResult{User: u, APIKey: plain}, nil
}
