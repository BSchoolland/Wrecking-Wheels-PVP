/**
 * Core game state types shared between frontend and backend
 */

export interface Vector2D {
  x: number;
  y: number;
}

export interface ContraptionPart {
  id: string;
  type: 'wheel' | 'block' | 'motor' | 'weapon' | 'propeller';
  position: Vector2D;
  rotation: number;
  // Add more properties as needed
}

export interface ContraptionBlueprint {
  id: string;
  name: string;
  parts: ContraptionPart[];
  cost: number; // Deployment cost
}

export interface ContraptionInstance {
  id: string;
  blueprintId: string;
  ownerId: string;
  position: Vector2D;
  velocity: Vector2D;
  rotation: number;
  health: number;
  // Physics body state
  physicsState: PhysicsBodyState;
}

export interface PhysicsBodyState {
  position: Vector2D;
  velocity: Vector2D;
  angle: number;
  angularVelocity: number;
  // Simplified physics state for network transmission
}

export interface Player {
  id: string;
  name: string;
  resources: number; // Current deployment points
  deck: ContraptionBlueprint[];
}

export interface TerrainState {
  // Define terrain representation
  obstacles: Obstacle[];
  destructibleElements: DestructibleElement[];
}

export interface Obstacle {
  id: string;
  position: Vector2D;
  width: number;
  height: number;
  type: 'solid' | 'gap' | 'destructible';
}

export interface DestructibleElement {
  id: string;
  position: Vector2D;
  health: number;
  type: string;
}

/**
 * The complete game state - this is what gets synchronized between host and client
 */
export interface GameState {
  // Match info
  matchId: string;
  tick: number; // Current game tick
  timestamp: number; // Server timestamp
  
  // Players
  players: Record<string, Player>; // keyed by player ID
  
  // Active contraptions on battlefield
  contraptions: Record<string, ContraptionInstance>; // keyed by contraption instance ID
  
  // Terrain/battlefield state
  terrain: TerrainState;
  
  // Win condition tracking
  winner?: string; // player ID if game is over
  matchDuration: number; // seconds elapsed
}
