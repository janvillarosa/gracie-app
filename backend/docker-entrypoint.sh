#!/bin/sh
set -e

echo "[entrypoint] Using DDB endpoint: ${DDB_ENDPOINT:-http://dynamodb:8000}"

attempts=0
max_attempts=${SETUP_RETRIES:-30}

echo "[entrypoint] Running setup-ddb (up to $max_attempts attempts)"
until /usr/local/bin/setup-ddb; do
  attempts=$((attempts+1))
  if [ "$attempts" -ge "$max_attempts" ]; then
    echo "[entrypoint] setup-ddb failed after $attempts attempts; continuing to start server"
    break
  fi
  echo "[entrypoint] setup-ddb failed (attempt $attempts). Retrying in 2s..."
  sleep 2
done

echo "[entrypoint] Starting gracie-server on port ${PORT:-8080}"
exec /usr/local/bin/gracie-server

