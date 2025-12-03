/**
 * Command types for client -> host communication
 */

export interface ContraptionData {
  id: string;
  name: string;
  blocks: Array<{
    id: string;
    type: string;
    gridX: number;
    gridY: number;
    health: number;
    stiffness: number;
    damage?: number;
    knockback?: number;
  }>;
  direction?: number;
  team?: string;
  isBot?: boolean;
  vehicleClass?: 'light' | 'medium' | 'heavy';
}

export type GameCommand = 
  | DeployCommand
  | ReadyCommand
  | SpawnBoxCommand
  | PlayerInitCommand
  | BlockInputCommand
  | PlayerReadyCommand
  | BuildReadyCommand
  | BuildLockCommand;

export interface DeployCommand {
  type: 'deploy';
  playerId: string;
  blueprintId: string;
  position: { x: number; y: number };
  timestamp: number; // client timestamp for latency compensation
}

export interface ReadyCommand {
  type: 'ready';
  playerId: string;
}

export interface SpawnBoxCommand {
  type: 'spawn-box';
  playerId: string;
  position: { x: number; y: number };
  contraption: ContraptionData;
}

export interface PlayerInitCommand {
  type: 'player-init';
  playerId: string;
  contraption?: ContraptionData;
}

export interface BlockInputCommand {
  type: 'block-input';
  playerId: string;
  bindingId: string; // e.g. 'rocket-hold', 'wheel-forward', 'wheel-reverse'
  phase: 'press' | 'release' | 'change';
  payload?: { [key: string]: unknown };
}

export interface PlayerReadyCommand {
  type: 'player-ready';
  playerId: string;
  contraption?: ContraptionData;
}

export interface BuildReadyCommand {
  type: 'build-ready';
  playerId: string;
  contraption?: ContraptionData; // optional interim blueprint preview
}

export interface BuildLockCommand {
  type: 'build-lock';
  playerId: string;
  contraption: ContraptionData; // final submitted blueprint
}

/**
 * UI State Update (host -> client, 5-10Hz, reliable)
 */
export interface UIState {
  resources: { [playerId: string]: { energy: number } };
  cooldowns: { [playerId: string]: number }; // timestamp when cooldown ends
  // Build Mode extras (only present in Build Mode)
  phase?: 'lobby' | 'build' | 'battle';
  timerSeconds?: number;
  ready?: [boolean, boolean];
  // Per-player inventory; keys are BlockType strings; values are counts
  inventory?: { [playerId: string]: { [blockType: string]: number } };
}

/**
 * Game Event (host -> client, one-off, reliable)
 */
export type GameEvent = 
  | { type: 'player-joined'; playerId: string }
  | { type: 'freeze' }
  | { type: 'unfreeze' }
  | { type: 'countdown-start' }
  | { type: 'game-over'; winner: string; loser: string };

/**
 * Network message wrapper
 */
export interface NetworkMessage<T = unknown> {
  type: 'command' | 'state' | 'ui-update' | 'event' | 'ping' | 'pong';
  payload: T;
  sequence?: number; // for message ordering
}
