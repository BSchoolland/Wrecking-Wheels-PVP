#!/bin/bash

# Wrecking Wheels PVP - Launch Script
# Starts both frontend and backend servers

echo "🎮 Starting Wrecking Wheels PVP..."

# Function to cleanup on exit
cleanup() {
  echo ""
  echo "🛑 Shutting down..."
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
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
