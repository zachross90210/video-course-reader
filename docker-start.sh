#!/bin/bash

# Load .env if it exists
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Create data directory and cache files if they don't exist
mkdir -p data

# Create empty JSON files if they don't exist (Docker needs them to exist as files, not directories)
[ ! -f data/.duration-cache.json ] && echo '{}' > data/.duration-cache.json
[ ! -f data/.progress.json ] && echo '{"completed":{},"lastPlayedId":null}' > data/.progress.json

# Check if COURSE_DIR is set and exists
COURSE_DIR="${COURSE_DIR:-./courses}"
if [ ! -d "$COURSE_DIR" ]; then
  echo "ERROR: Course directory does not exist: $COURSE_DIR"
  echo "Please set COURSE_DIR in .env file or ensure ./courses directory exists"
  exit 1
fi

if [ -z "$(ls -A "$COURSE_DIR" 2>/dev/null)" ]; then
  echo "WARNING: Course directory is empty: $COURSE_DIR"
  echo "The container will fail to start if the directory remains empty."
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Rebuild and start docker-compose
echo "Rebuilding and starting Docker containers..."
docker-compose down
docker-compose up -d --build

# Wait a moment and check if containers are running
sleep 2
if docker-compose ps | grep -q "Up"; then
  echo ""
  echo "✓ Services started successfully!"
  echo "Access the application at http://localhost${PORT:+:${PORT:-80}}"
  echo ""
  echo "View logs with: docker-compose logs -f"
  echo "Check status with: docker-compose ps"
else
  echo ""
  echo "⚠ Some containers may have failed to start."
  echo "Check logs with: docker-compose logs"
  exit 1
fi
