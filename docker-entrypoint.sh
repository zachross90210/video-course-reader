#!/bin/sh
set -e

COURSE_DIR="${COURSE_DIR:-/app/courses}"

echo "Checking courses directory: $COURSE_DIR"

# Check if directory exists
if [ ! -d "$COURSE_DIR" ]; then
  echo "ERROR: Courses directory does not exist: $COURSE_DIR"
  exit 1
fi

# Check if directory is empty
if [ -z "$(ls -A "$COURSE_DIR" 2>/dev/null)" ]; then
  echo "ERROR: Courses directory is empty: $COURSE_DIR"
  echo "Please ensure the course directory is properly mounted and contains video files."
  exit 1
fi

echo "✓ Courses directory is not empty"
echo "Starting application..."

# Execute the main command
exec "$@"
