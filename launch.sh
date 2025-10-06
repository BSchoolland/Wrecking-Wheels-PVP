#!/bin/bash

# Wrecking Wheels PVP - Launch Script
# Starts both frontend and backend servers

echo "🎮 Starting Wrecking Wheels PVP..."

# Force development mode for this session
export NODE_ENV=development

# Function to cleanup on exit
cleanup() {
  echo ""
  echo "🛑 Shutting down..."
  # kill processes on ports 3000 and 3001
  fuser -k 3000/tcp
  fuser -k 3001/tcp
  exit
}

trap cleanup SIGINT SIGTERM

# Check if dependencies are installed
if [ ! -d "frontend/node_modules" ]; then
  echo "📦 Installing frontend dependencies..."
  cd frontend && npm install && cd ..
fi

if [ ! -d "backend/node_modules" ]; then
  echo "📦 Installing backend dependencies..."
  cd backend && npm install && cd ..
fi

# Ensure dev dependencies (vite/tsx) are available
if [ ! -x "frontend/node_modules/.bin/vite" ]; then
  echo "📦 Installing frontend dev dependencies (vite)..."
  (cd frontend && npm install --include=dev)
fi

if [ ! -x "backend/node_modules/.bin/tsx" ]; then
  echo "📦 Installing backend dev dependencies (tsx)..."
  (cd backend && npm install --include=dev)
fi

# Start backend
echo "🚀 Starting backend server..."
(cd backend && npm run dev) &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 2

# Start frontend
echo "🎨 Starting frontend dev server..."
(cd frontend && npm run dev) &
FRONTEND_PID=$!

echo ""
echo "✅ Servers running:"
echo "   Frontend: http://localhost:3000"
echo "   Backend:  http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop all servers"

# Wait for both processes
wait
