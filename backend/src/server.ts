/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Backend Server - Game server with physics, matchmaking, and state sync
 */

import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { GameSession, type NetworkSnapshot } from './game/GameSession';
import './game/InputBindings';
import type { GameCommand, UIState, GameEvent } from '@shared/types/Commands';
import '@shared/contraptions';

const app = express() as any;
const server = createServer(app as any);
const wss = new WebSocketServer({ server, path: '/ws' });

// Middleware
app.use((cors as any)());
app.use(express.json());

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// API routes will be added here
const apiExt = process.env.NODE_ENV === 'production' ? '.js' : '.ts';
const matchmakingModule = await import(`./api/matchmaking${apiExt}`);
app.use('/api/matchmaking', matchmakingModule.default);
const lobbyPlayerOrderFromMatchmaking = matchmakingModule.lobbyPlayerOrder;
const lobbyModesFromMatchmaking = matchmakingModule.lobbyModes;

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
  playerId?: string; // The player's game ID
}

const clients = new Map<string, WSClient>();
const gameSessions = new Map<string, GameSession>();

// WebSocket for lobby, signaling, and game communication
wss.on('connection', (ws: WebSocket) => {
  const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  clients.set(clientId, { ws, id: clientId });

  // Send client their ID
  ws.send(JSON.stringify({ type: 'connected', clientId }));

  ws.on('message', (message: string | Buffer | ArrayBuffer | Buffer[]) => {
    try {
      const text = typeof message === 'string'
        ? message
        : Array.isArray(message)
          ? Buffer.concat(message).toString()
          : Buffer.isBuffer(message)
            ? message.toString()
            : Buffer.from(message).toString();
      const data = JSON.parse(text);

      switch (data.type) {
        case 'join-lobby':
          handleJoinLobby(clientId, data.lobbyId, data.playerId);
          break;
        
        case 'command':
          // Game command from client
          handleGameCommand(clientId, data.payload as GameCommand);
          break;
        
        case 'leave-lobby':
          handleLeaveLobby(clientId);
          break;
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    handleLeaveLobby(clientId);
    clients.delete(clientId);
  });
});

function handleJoinLobby(clientId: string, lobbyId: string, playerId: string) {
  const client = clients.get(clientId);
  if (!client) return;

  client.lobbyId = lobbyId;
  client.playerId = playerId;

  // Find other clients in the same lobby
  const lobbyClients = Array.from(clients.values()).filter(
    c => c.lobbyId === lobbyId && c.id !== clientId
  );

  // Notify this client about connection
  client.ws.send(JSON.stringify({
    type: 'lobby-joined',
    lobbyId,
    playersInLobby: lobbyClients.length + 1,
  }));

  // Notify other clients
  lobbyClients.forEach(peer => {
    peer.ws.send(JSON.stringify({
      type: 'peer-joined',
      peerId: clientId,
      playerId: playerId,
    }));
  });

  // If we now have 2 players, create the game session
  if (lobbyClients.length === 1) {
    // Use the correct player order from matchmaking, not WS connection order
    const correctPlayerOrder = lobbyPlayerOrderFromMatchmaking.get(lobbyId);
    const players = correctPlayerOrder || [lobbyClients[0].playerId!, playerId];
    createGameSession(lobbyId, players);
    
    // Notify both clients that the game is starting
    const allLobbyClients = Array.from(clients.values()).filter(c => c.lobbyId === lobbyId);
    allLobbyClients.forEach(c => {
      c.ws.send(JSON.stringify({ type: 'game-ready' }));
    });
  }
}

function createGameSession(lobbyId: string, players: string[]) {
  if (gameSessions.has(lobbyId)) return;

  const mode: 'normal' | 'build' = lobbyModesFromMatchmaking.get(lobbyId) || 'normal';
  const session = new GameSession(lobbyId, players, {
    onStateUpdate: (state: NetworkSnapshot) => {
      broadcastToLobby(lobbyId, { type: 'state', payload: state });
    },
    onUIUpdate: (uiState: UIState) => {
      broadcastToLobby(lobbyId, { type: 'ui-update', payload: uiState });
    },
    onEvent: (event: GameEvent) => {
      broadcastToLobby(lobbyId, { type: 'event', payload: event });
    },
  }, mode);

  gameSessions.set(lobbyId, session);
  session.start();
  console.log(`Game session started for lobby ${lobbyId}`);
}

function handleGameCommand(clientId: string, command: GameCommand) {
  const client = clients.get(clientId);
  if (!client || !client.lobbyId) return;

  const session = gameSessions.get(client.lobbyId);
  if (!session) return;

  session.handleCommand(command);
}

function broadcastToLobby(lobbyId: string, message: unknown) {
  const lobbyClients = Array.from(clients.values()).filter(c => c.lobbyId === lobbyId);
  const messageStr = JSON.stringify(message);
  
  lobbyClients.forEach(client => {
    if ((client.ws as unknown as { readyState: number }).readyState === 1) { // 1 = OPEN
      client.ws.send(messageStr);
    }
  });
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

  // Check if lobby is now empty or has only one player
  const remainingClients = Array.from(clients.values()).filter(
    c => c.lobbyId === lobbyId && c.id !== clientId
  );
  
  if (remainingClients.length === 0) {
    // Destroy game session if no players left
    const session = gameSessions.get(lobbyId);
    if (session) {
      session.destroy();
      gameSessions.delete(lobbyId);
      console.log(`Game session ended for lobby ${lobbyId}`);
    }
  }

  client.lobbyId = undefined;
  client.playerId = undefined;
}

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
