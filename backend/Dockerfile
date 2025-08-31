# syntax=docker/dockerfile:1

FROM golang:1.22-alpine AS builder
WORKDIR /app/backend
RUN apk add --no-cache git

# Cache deps
COPY backend/go.mod backend/go.sum ./
RUN go mod download

# Build binaries
COPY backend ./
RUN mkdir -p /out && \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/gracie-server ./cmd/gracie-server && \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/setup-ddb ./cmd/setup-ddb

FROM alpine:3.20
RUN adduser -D -h /app app && apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /out/gracie-server /usr/local/bin/gracie-server
COPY --from=builder /out/setup-ddb /usr/local/bin/setup-ddb
COPY backend/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
# Ensure entrypoint is executable before switching to non-root user
RUN chmod +x /usr/local/bin/entrypoint.sh
USER app

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
