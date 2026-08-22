#!/bin/sh
set -e

echo "[start] launching ollama serve..."
ollama serve &
OLLAMA_PID=$!

echo "[start] waiting for ollama to be ready..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
    echo "[start] ollama is ready."
    break
  fi
  sleep 1
done

echo "[start] launching webnail API..."
node src/index.js &
API_PID=$!

# If either process dies, tear the container down so Render restarts it.
wait -n "$OLLAMA_PID" "$API_PID"
exit $?
