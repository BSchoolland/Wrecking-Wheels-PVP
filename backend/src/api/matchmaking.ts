/**
 * Matchmaking API
 * Handles lobby creation, joining, and match coordination
 */

import { Router, Request, Response } from 'express';

const router = Router() as unknown as {
  post: typeof Router.prototype.post;
  get: typeof Router.prototype.get;
};

// In-memory storage for lobbies (replace with database later)
interface Lobby {
  id: string;
  hostId: string;
  players: string[];
  maxPlayers: number;
  status: 'waiting' | 'ready' | 'in-progress' | 'completed';
  createdAt: number;
}

const lobbies = new Map<string, Lobby>();

/**
 * Create a new lobby
 */
router.post('/lobby/create', (req: Request, res: Response) => {
  const { hostId, maxPlayers = 2 } = (req.body ?? {}) as { hostId?: string; maxPlayers?: number };

  if (!hostId) {
    return res.status(400).json({ error: 'hostId is required' });
  }

  const lobbyId = `lobby-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  const lobby: Lobby = {
    id: lobbyId,
    hostId,
    players: [hostId],
    maxPlayers,
    status: 'waiting',
    createdAt: Date.now(),
  };

  lobbies.set(lobbyId, lobby);

  res.json({ 
    success: true,
    lobby: {
      id: lobby.id,
      players: lobby.players,
      status: lobby.status,
    }
  });
});

/**
 * Join an existing lobby
 */
router.post('/lobby/join', (req: Request, res: Response) => {
  const { lobbyId, playerId } = (req.body ?? {}) as { lobbyId?: string; playerId?: string };

  if (!lobbyId || !playerId) {
    return res.status(400).json({ error: 'lobbyId and playerId are required' });
  }

  const lobby = lobbies.get(lobbyId);

  if (!lobby) {
    return res.status(404).json({ error: 'Lobby not found' });
  }

  if (lobby.players.length >= lobby.maxPlayers) {
    return res.status(400).json({ error: 'Lobby is full' });
  }

  if (lobby.status !== 'waiting') {
    return res.status(400).json({ error: 'Lobby is not accepting players' });
  }

  if (!lobby.players.includes(playerId)) {
    lobby.players.push(playerId);
  }

  // If lobby is full, mark as ready
  if (lobby.players.length === lobby.maxPlayers) {
    lobby.status = 'ready';
  }

  res.json({
    success: true,
    lobby: {
      id: lobby.id,
      players: lobby.players,
      status: lobby.status,
      isHost: playerId === lobby.hostId,
    }
  });
});

/**
 * Get lobby status
 */
router.get('/lobby/:lobbyId', (req: Request, res: Response) => {
  const { lobbyId } = (req.params ?? {}) as { lobbyId: string };
  const lobby = lobbies.get(lobbyId);

  if (!lobby) {
    return res.status(404).json({ error: 'Lobby not found' });
  }

  res.json({
    lobby: {
      id: lobby.id,
      players: lobby.players,
      status: lobby.status,
      maxPlayers: lobby.maxPlayers,
    }
  });
});

/**
 * List all available lobbies
 */
router.get('/lobbies', (_req: Request, res: Response) => {
  const availableLobbies = Array.from(lobbies.values())
    .filter(lobby => lobby.status === 'waiting')
    .map(lobby => ({
      id: lobby.id,
      players: lobby.players.length,
      maxPlayers: lobby.maxPlayers,
      createdAt: lobby.createdAt,
    }));

  res.json({ lobbies: availableLobbies });
});

/**
 * Leave a lobby
 */
router.post('/lobby/leave', (req: Request, res: Response) => {
  const { lobbyId, playerId } = (req.body ?? {}) as { lobbyId?: string; playerId?: string };

  if (!lobbyId || !playerId) {
    return res.status(400).json({ error: 'lobbyId and playerId are required' });
  }

  const lobby = lobbies.get(lobbyId);

  if (!lobby) {
    return res.status(404).json({ error: 'Lobby not found' });
  }

  lobby.players = lobby.players.filter(id => id !== playerId);

  // If host leaves or lobby is empty, delete it
  if (playerId === lobby.hostId || lobby.players.length === 0) {
    lobbies.delete(lobbyId);
    return res.json({ success: true, lobbyDeleted: true });
  }

  res.json({ success: true });
});

// Minimal queue-based matchmaking
let waitingLobbyId: string | undefined; // lobby waiting for a second player

router.post('/queue/join', (req: Request, res: Response) => {
  const { playerId } = (req.body ?? {}) as { playerId?: string };
  if (!playerId) {
    return res.status(400).json({ error: 'playerId is required' });
  }

  // If no waiting lobby, create one and assign as host
  if (!waitingLobbyId) {
    const lobbyId = `lobby-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const lobby: Lobby = {
      id: lobbyId,
      hostId: playerId,
      players: [playerId],
      maxPlayers: 2,
      status: 'waiting',
      createdAt: Date.now(),
    };
    lobbies.set(lobbyId, lobby);
    waitingLobbyId = lobbyId;
    return res.json({ success: true, lobbyId, role: 'host', status: 'waiting' });
  }

  // Join the waiting lobby as client
  const lobby = lobbies.get(waitingLobbyId);
  if (!lobby) {
    // Race condition guard: recreate as host
    waitingLobbyId = undefined;
    const lobbyId = `lobby-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newLobby: Lobby = {
      id: lobbyId,
      hostId: playerId,
      players: [playerId],
      maxPlayers: 2,
      status: 'waiting',
      createdAt: Date.now(),
    };
    lobbies.set(lobbyId, newLobby);
    waitingLobbyId = lobbyId;
    return res.json({ success: true, lobbyId, role: 'host', status: 'waiting' });
  }

  if (lobby.players.length >= 2 || lobby.status !== 'waiting') {
    // Should not happen for the single waiting lobby; reset and try again as host
    waitingLobbyId = undefined;
    const lobbyId = `lobby-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newLobby: Lobby = {
      id: lobbyId,
      hostId: playerId,
      players: [playerId],
      maxPlayers: 2,
      status: 'waiting',
      createdAt: Date.now(),
    };
    lobbies.set(lobbyId, newLobby);
    waitingLobbyId = lobbyId;
    return res.json({ success: true, lobbyId, role: 'host', status: 'waiting' });
  }

  if (!lobby.players.includes(playerId)) {
    lobby.players.push(playerId);
  }
  lobby.status = 'ready';

  const lobbyId = lobby.id;
  waitingLobbyId = undefined; // waiting lobby consumed
  return res.json({ success: true, lobbyId, role: 'client', status: 'ready', players: lobby.players });
});

router.post('/queue/leave', (req: Request, res: Response) => {
  const { playerId } = (req.body ?? {}) as { playerId?: string };
  if (!playerId) {
    return res.status(400).json({ error: 'playerId is required' });
  }

  if (!waitingLobbyId) return res.json({ success: true });
  const lobby = lobbies.get(waitingLobbyId);
  if (!lobby) {
    waitingLobbyId = undefined;
    return res.json({ success: true });
  }

  // If the waiting host leaves, delete the lobby and clear queue
  if (lobby.hostId === playerId) {
    lobbies.delete(waitingLobbyId);
    waitingLobbyId = undefined;
    return res.json({ success: true, lobbyDeleted: true });
  }

  // If a queued non-host calls leave (unlikely), just ensure they aren't in lobby
  lobby.players = lobby.players.filter(id => id !== playerId);
  return res.json({ success: true });
});

export default router;
