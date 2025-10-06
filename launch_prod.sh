#!/bin/bash

# Production launch script - builds frontend and backend and runs Express server on one port

set -euo pipefail

echo "📦 Building frontend..."
(cd frontend && npm ci --include=dev && npm run build)

echo "📦 Building backend..."
(cd backend && npm ci && npm run build)

# Start the backend (which will serve the built frontend in production)
export NODE_ENV=production
PORT=${PORT:-3000}

echo "🚀 Starting backend server on port ${PORT} (serving frontend from frontend/dist)..."
(cd backend && PORT=${PORT} npm run start) &
BACKEND_PID=$!

trap "echo \"🛑 Shutting down...\"; kill ${BACKEND_PID} 2>/dev/null || true; wait ${BACKEND_PID}; exit" SIGINT SIGTERM

wait ${BACKEND_PID}

