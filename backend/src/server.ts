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

// WebSocket connection management
interface WSClient {
  ws: any;
  id: string;
  lobbyId?: string;
  role?: 'host' | 'client';
}

const clients = new Map<string, WSClient>();

// WebSocket for lobby and signaling
wss.on('connection', (ws) => {
  const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  clients.set(clientId, { ws, id: clientId });
  
  console.log(`Client connected: ${clientId}`);

  // Send client their ID
  ws.send(JSON.stringify({ type: 'connected', clientId }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log('Received:', data.type, 'from', clientId);

      switch (data.type) {
        case 'join-lobby':
          handleJoinLobby(clientId, data.lobbyId, data.role);
          break;
        
        case 'signal':
          // Forward WebRTC signaling data to the other peer
          handleSignal(clientId, data);
          break;
        
        case 'leave-lobby':
          handleLeaveLobby(clientId);
          break;
        
        default:
          console.log('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    console.log(`Client disconnected: ${clientId}`);
    handleLeaveLobby(clientId);
    clients.delete(clientId);
  });
});

function handleJoinLobby(clientId: string, lobbyId: string, role: 'host' | 'client') {
  const client = clients.get(clientId);
  if (!client) return;

  client.lobbyId = lobbyId;
  client.role = role;

  // Find other clients in the same lobby
  const lobbyClients = Array.from(clients.values()).filter(
    c => c.lobbyId === lobbyId && c.id !== clientId
  );

  // Notify this client about other peers in the lobby
  lobbyClients.forEach(peer => {
    client.ws.send(JSON.stringify({
      type: 'peer-joined',
      peerId: peer.id,
      peerRole: peer.role,
    }));

    // Also notify the peer about this client
    peer.ws.send(JSON.stringify({
      type: 'peer-joined',
      peerId: clientId,
      peerRole: role,
    }));
  });

  console.log(`Client ${clientId} joined lobby ${lobbyId} as ${role}`);
}

function handleSignal(fromClientId: string, data: any) {
  const fromClient = clients.get(fromClientId);
  if (!fromClient || !fromClient.lobbyId) return;

  // Find the target peer
  const targetClient = data.targetId 
    ? clients.get(data.targetId)
    : Array.from(clients.values()).find(
        c => c.lobbyId === fromClient.lobbyId && c.id !== fromClientId
      );

  if (targetClient) {
    targetClient.ws.send(JSON.stringify({
      type: 'signal',
      fromId: fromClientId,
      signal: data.signal,
    }));
  }
}

function handleLeaveLobby(clientId: string) {
  const client = clients.get(clientId);
  if (!client || !client.lobbyId) return;

  const lobbyId = client.lobbyId;
  
  // Notify other clients in the lobby
  Array.from(clients.values())
    .filter(c => c.lobbyId === lobbyId && c.id !== clientId)
    .forEach(peer => {
      peer.ws.send(JSON.stringify({
        type: 'peer-left',
        peerId: clientId,
      }));
    });

  client.lobbyId = undefined;
  client.role = undefined;
}

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server ready`);
});
