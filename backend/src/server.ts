/**
 * Backend Server - Thin server for matchmaking, storage, and signaling
 * Does NOT run game logic or physics
 */

import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// API routes will be added here
app.use('/api/matchmaking', (await import('./api/matchmaking.js')).default);

// WebSocket for lobby and signaling
wss.on('connection', (ws) => {
  console.log('Client connected to WebSocket');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log('Received:', data);

      // Handle different message types
      switch (data.type) {
        case 'signal':
          // Forward WebRTC signaling data between peers
          // TODO: Implement signaling logic
          break;
        case 'join-lobby':
          // Handle lobby join
          break;
        default:
          console.log('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected from WebSocket');
  });

  // Send welcome message
  ws.send(JSON.stringify({ type: 'welcome', message: 'Connected to Wrecking Wheels server' }));
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server ready`);
});
