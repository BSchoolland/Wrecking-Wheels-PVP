/**
 * Backend Server - Thin server for matchmaking, storage, and signaling
 * Does NOT run game logic or physics
 */

import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { Request, Response } from 'express';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// API routes will be added here
const apiExt = process.env.NODE_ENV === 'production' ? '.js' : '.ts';
app.use('/api/matchmaking', (await import(`./api/matchmaking${apiExt}`)).default);

// Serve built frontend in production from the project's frontend/dist
if (process.env.NODE_ENV === 'production') {
  const staticPath = path.join(process.cwd(), '..', 'frontend', 'dist');
  app.use(express.static(staticPath));

  // Fallback to index.html for client-side routing
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(staticPath, 'index.html'));
  });
}

// WebSocket connection management
interface WSClient {
  ws: WebSocket;
  id: string;
  lobbyId?: string;
  role?: 'host' | 'client';
}

const clients = new Map<string, WSClient>();

// WebSocket for lobby and signaling
wss.on('connection', (ws: WebSocket) => {
  const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  clients.set(clientId, { ws, id: clientId });
  
  console.log(`[server] Client connected: ${clientId}`);

  // Send client their ID
  ws.send(JSON.stringify({ type: 'connected', clientId }));

  ws.on('message', (message: string | Buffer) => {
    try {
      const data = JSON.parse(message.toString());
      console.log(`[server] Received: ${data.type} from ${clientId}`);

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
          console.log(`[server] Unknown message type: ${data.type}`);
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    console.log(`[server] Client disconnected: ${clientId}`);
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

  console.log(`[server] Client ${clientId} joined lobby ${lobbyId} as ${role} (${lobbyClients.length} other peer(s) already in lobby)`);
}

function handleSignal(fromClientId: string, data: { targetId?: string; signal: unknown }) {
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
  console.log(`[server] Server running on port ${PORT}`);
  console.log(`[server] WebSocket server ready on path /ws`);
});
