module github.com/janvillarosa/gracie-app/backend

go 1.22

require (
	github.com/aws/aws-sdk-go-v2 v1.38.2
	github.com/aws/aws-sdk-go-v2/config v1.27.21
	github.com/aws/aws-sdk-go-v2/credentials v1.17.21
	github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue v1.20.8
	github.com/aws/aws-sdk-go-v2/service/dynamodb v1.50.0
	github.com/go-chi/chi/v5 v5.0.12
	golang.org/x/crypto v0.25.0
)

require (
	github.com/aws/aws-sdk-go-v2/feature/ec2/imds v1.16.8 // indirect
	github.com/aws/aws-sdk-go-v2/internal/configsources v1.4.5 // indirect
	github.com/aws/aws-sdk-go-v2/internal/endpoints/v2 v2.7.5 // indirect
	github.com/aws/aws-sdk-go-v2/internal/ini v1.8.0 // indirect
	github.com/aws/aws-sdk-go-v2/service/dynamodbstreams v1.30.1 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/accept-encoding v1.13.1 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/endpoint-discovery v1.11.5 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/presigned-url v1.11.14 // indirect
	github.com/aws/aws-sdk-go-v2/service/sso v1.21.1 // indirect
	github.com/aws/aws-sdk-go-v2/service/ssooidc v1.25.1 // indirect
	github.com/aws/aws-sdk-go-v2/service/sts v1.29.1 // indirect
	github.com/aws/smithy-go v1.23.0 // indirect
)
