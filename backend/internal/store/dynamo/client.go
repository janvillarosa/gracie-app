package dynamo

import (
    "context"

    "github.com/aws/aws-sdk-go-v2/aws"
    awsconfig "github.com/aws/aws-sdk-go-v2/config"
    "github.com/aws/aws-sdk-go-v2/credentials"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

type Tables struct {
    Users string
    Rooms string
    Lists string
    ListItems string
}

type Client struct {
    DB     *dynamodb.Client
    Tables Tables
}

func New(ctx context.Context, region, endpoint string, tables Tables) (*Client, error) {
    var (
        cfg aws.Config
        err error
    )
    if endpoint != "" {
        // DynamoDB Local mode: use static creds and custom endpoint
        cfg, err = awsconfig.LoadDefaultConfig(ctx,
            awsconfig.WithRegion(region),
            awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider("local", "local", "")),
            awsconfig.WithEndpointResolverWithOptions(aws.EndpointResolverWithOptionsFunc(
                func(service, region string, options ...interface{}) (aws.Endpoint, error) {
                    return aws.Endpoint{URL: endpoint, HostnameImmutable: true, PartitionID: "aws"}, nil
                },
            )),
        )
    } else {
        // AWS-managed DynamoDB: default credentials chain + standard endpoints
        cfg, err = awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
    }
    if err != nil {
        return nil, err
    }
    db := dynamodb.NewFromConfig(cfg)
    return &Client{DB: db, Tables: tables}, nil
}
