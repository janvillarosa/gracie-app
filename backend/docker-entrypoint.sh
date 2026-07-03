#!/bin/sh
set -e

# Ensure ENC_KEY_FILE directory exists (for Mongo/production mounts)
if [ -n "$ENC_KEY_FILE" ]; then
  keydir=$(dirname "$ENC_KEY_FILE")
  mkdir -p "$keydir" || true
fi

echo "[entrypoint] Starting gracie-server on port ${PORT:-8080}"
exec /usr/local/bin/gracie-server
