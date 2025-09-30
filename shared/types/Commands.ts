/**
 * Command types for client -> host communication
 */

export type GameCommand = 
  | DeployCommand
  | ReadyCommand;

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

/**
 * Network message wrapper
 */
export interface NetworkMessage<T = unknown> {
  type: 'command' | 'state' | 'event';
  payload: T;
  sequence?: number; // for message ordering
}
