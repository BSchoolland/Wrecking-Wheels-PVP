/**
 * Game State Management
 * Central source of truth for game state
 */

import type { GameState, Player, ContraptionInstance } from '@shared/types/GameState';
import { GAME_CONSTANTS } from '@shared/constants/game';

export class GameStateManager {
  private state: GameState;

  constructor(matchId: string, playerIds: string[]) {
    // Initialize empty game state
    this.state = this.createInitialState(matchId, playerIds);
  }

  private createInitialState(matchId: string, playerIds: string[]): GameState {
    const players: Record<string, Player> = {};
    
    playerIds.forEach((id, index) => {
      players[id] = {
        id,
        name: `Player ${index + 1}`,
        resources: GAME_CONSTANTS.STARTING_RESOURCES,
        deck: [], // Will be populated when player selects deck
      };
    });

    return {
      matchId,
      tick: 0,
      timestamp: Date.now(),
      players,
      contraptions: {},
      terrain: {
        obstacles: [],
        destructibleElements: [],
      },
      matchDuration: 0,
    };
  }

  /**
   * Get the current game state (immutable)
   */
  getState(): Readonly<GameState> {
    return this.state;
  }

  /**
   * Update the entire state (for client receiving from host)
   */
  setState(newState: GameState): void {
    this.state = newState;
  }

  /**
   * Increment game tick
   */
  tick(): void {
    this.state.tick++;
    this.state.timestamp = Date.now();
  }

  /**
   * Add resources to a player (passive income)
   */
  addPlayerResources(playerId: string, amount: number): void {
    const player = this.state.players[playerId];
    if (player) {
      player.resources += amount;
    }
  }

  /**
   * Spend player resources (for deployment)
   */
  spendPlayerResources(playerId: string, amount: number): boolean {
    const player = this.state.players[playerId];
    if (player && player.resources >= amount) {
      player.resources -= amount;
      return true;
    }
    return false;
  }

  /**
   * Add a contraption instance to the battlefield
   */
  addContraption(contraption: ContraptionInstance): void {
    this.state.contraptions[contraption.id] = contraption;
  }

  /**
   * Remove a contraption from the battlefield
   */
  removeContraption(contraptionId: string): void {
    delete this.state.contraptions[contraptionId];
  }

  /**
   * Update a contraption's state
   */
  updateContraption(contraptionId: string, updates: Partial<ContraptionInstance>): void {
    const contraption = this.state.contraptions[contraptionId];
    if (contraption) {
      Object.assign(contraption, updates);
    }
  }

  /**
   * Check if game is over
   */
  checkWinCondition(): string | null {
    // TODO: Implement win condition logic
    // For now, just check if match duration exceeded
    if (this.state.matchDuration >= GAME_CONSTANTS.MATCH_DURATION) {
      // Determine winner based on some metric
      return Object.keys(this.state.players)[0]; // Placeholder
    }
    return null;
  }

  /**
   * Set the winner
   */
  setWinner(playerId: string): void {
    this.state.winner = playerId;
  }

  /**
   * Serialize state for network transmission
   */
  serialize(): GameState {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * Deserialize state from network
   */
  deserialize(data: GameState): void {
    this.state = data;
  }
}
