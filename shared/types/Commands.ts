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
}

export type GameCommand = 
  | DeployCommand
  | ReadyCommand
  | SpawnBoxCommand
  | PlayerInitCommand;

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
}

/**
 * UI State Update (host -> client, 5-10Hz, reliable)
 */
export interface UIState {
  resources: { [playerId: string]: { energy: number } };
  cooldowns: { [playerId: string]: number }; // timestamp when cooldown ends
}

/**
 * Game Event (host -> client, one-off, reliable)
 */
export type GameEvent = 
  | { type: 'game-over'; winner: 'host' | 'client' }
  | { type: 'player-joined'; playerId: string };

/**
 * Network message wrapper
 */
export interface NetworkMessage<T = unknown> {
  type: 'command' | 'state' | 'ui-update' | 'event';
  payload: T;
  sequence?: number; // for message ordering
}
