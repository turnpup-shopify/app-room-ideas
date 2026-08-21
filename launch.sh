#!/bin/bash

# HTGT Room Ideas — dev launcher
# Usage: ./launch.sh
# Or from anywhere: bash /Users/alexturney/scripts/app-room-ideas/launch.sh

cd "$(dirname "$0")"

# Check node is available
if ! command -v node &> /dev/null; then
  echo "Error: Node.js not found. Install from https://nodejs.org"
  exit 1
fi

# Install dependencies if node_modules is missing
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Start the dev server and open the browser once it's ready
echo "Starting HTGT Room Ideas..."
npm run dev &
SERVER_PID=$!

# Wait for the server to be ready, then open the browser
while ! curl -s http://localhost:3000 > /dev/null 2>&1; do
  sleep 1
done

open http://localhost:3000

# Keep the script running (Ctrl+C to stop the server)
wait $SERVER_PID
