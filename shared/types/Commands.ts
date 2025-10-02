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
  | SpawnBoxCommand;

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

/**
 * Network message wrapper
 */
export interface NetworkMessage<T = unknown> {
  type: 'command' | 'state' | 'event';
  payload: T;
  sequence?: number; // for message ordering
}
