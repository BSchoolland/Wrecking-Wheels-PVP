/**
 * Main Game Loop - Runs only on Host
 * Manages the core update cycle, physics, and state synchronization
 */

import { PhysicsEngine } from '@/core/physics/PhysicsEngine';
import { GameStateManager } from '@/core/state/GameState';
import { PeerConnection } from '@/core/networking/PeerConnection';
import { PHYSICS_CONSTANTS } from '@shared/constants/physics';
import { GAME_CONSTANTS } from '@shared/constants/game';
import type { GameCommand } from '@shared/types/Commands';

export class GameLoop {
  private physics: PhysicsEngine;
  private stateManager: GameStateManager;
  private network: PeerConnection | null;
  private isRunning = false;
  private lastUpdateTime = 0;
  private accumulator = 0;
  private lastSyncTime = 0;
  private gameStartTime = 0;

  constructor(
    matchId: string,
    playerIds: string[],
    network: PeerConnection | null = null
  ) {
    this.physics = new PhysicsEngine();
    this.stateManager = new GameStateManager(matchId, playerIds);
    this.network = network;
  }

  /**
   * Start the game loop
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.gameStartTime = Date.now();
    this.lastUpdateTime = Date.now();
    this.physics.start();
    
    // Start the update loop
    this.update();
  }

  /**
   * Stop the game loop
   */
  stop(): void {
    this.isRunning = false;
    this.physics.stop();
  }

  /**
   * Main update loop (runs via requestAnimationFrame)
   */
  private update = (): void => {
    if (!this.isRunning) return;

    const currentTime = Date.now();
    const deltaTime = currentTime - this.lastUpdateTime;
    this.lastUpdateTime = currentTime;

    // Fixed timestep physics update
    this.accumulator += deltaTime;

    while (this.accumulator >= PHYSICS_CONSTANTS.FIXED_TIMESTEP) {
      this.fixedUpdate();
      this.accumulator -= PHYSICS_CONSTANTS.FIXED_TIMESTEP;
    }

    // Send state updates to client at configured rate
    if (this.network && currentTime - this.lastSyncTime >= 1000 / PHYSICS_CONSTANTS.STATE_SYNC_RATE) {
      this.syncState();
      this.lastSyncTime = currentTime;
    }

    // Continue loop
    requestAnimationFrame(this.update);
  };

  /**
   * Fixed timestep update for game logic and physics
   */
  private fixedUpdate(): void {
    // Update game tick
    this.stateManager.tick();

    // Update match duration
    const state = this.stateManager.getState();
    const newDuration = (Date.now() - this.gameStartTime) / 1000;
    
    // Add passive resources to players
    const resourceDelta = (newDuration - state.matchDuration) * GAME_CONSTANTS.PASSIVE_RESOURCE_RATE;
    Object.keys(state.players).forEach(playerId => {
      this.stateManager.addPlayerResources(playerId, resourceDelta);
    });

    // Update contraptions from physics
    this.updateContraptionsFromPhysics();

    // Check win condition
    const winner = this.stateManager.checkWinCondition();
    if (winner) {
      this.stateManager.setWinner(winner);
      this.stop();
    }
  }

  /**
   * Update contraption states from physics engine
   */
  private updateContraptionsFromPhysics(): void {
    const bodies = this.physics.getAllBodies();
    const state = this.stateManager.getState();

    // Update each contraption with its physics state
    Object.values(state.contraptions).forEach(contraption => {
      // Find corresponding physics body (TODO: implement body tracking)
      // For now, this is a placeholder
      const physicsState = this.physics.serializeBody(bodies[0]); // Placeholder
      
      this.stateManager.updateContraption(contraption.id, {
        physicsState,
        position: physicsState.position,
        velocity: physicsState.velocity,
        rotation: physicsState.angle,
      });
    });
  }

  /**
   * Synchronize state to client
   */
  private syncState(): void {
    if (!this.network) return;

    const state = this.stateManager.serialize();
    this.network.sendState(state);
  }

  /**
   * Handle incoming command from client (or local)
   */
  handleCommand(command: GameCommand): void {
    switch (command.type) {
      case 'deploy':
        this.handleDeployCommand(command);
        break;
      case 'ready':
        // Handle ready state
        break;
    }
  }

  /**
   * Handle deployment command
   */
  private handleDeployCommand(command: GameCommand): void {
    if (command.type !== 'deploy') return;

    const state = this.stateManager.getState();
    const player = state.players[command.playerId];
    
    if (!player) return;

    // Find blueprint in player's deck
    const blueprint = player.deck.find(bp => bp.id === command.blueprintId);
    if (!blueprint) return;

    // Check if player has enough resources
    if (!this.stateManager.spendPlayerResources(command.playerId, blueprint.cost)) {
      return; // Not enough resources
    }

    // Create contraption instance
    // TODO: Build actual contraption from blueprint
    // For now, create a simple placeholder
    const contraptionId = `${command.playerId}-${Date.now()}`;
    
    // TODO: Create physics body for contraption
    // const physicsBody = this.createContraptionPhysics(blueprint);
    
    // Add to game state
    this.stateManager.addContraption({
      id: contraptionId,
      blueprintId: blueprint.id,
      ownerId: command.playerId,
      position: command.position,
      velocity: { x: 0, y: 0 },
      rotation: 0,
      health: 100,
      physicsState: {
        position: command.position,
        velocity: { x: 0, y: 0 },
        angle: 0,
        angularVelocity: 0,
      },
    });
  }

  /**
   * Get current game state
   */
  getState() {
    return this.stateManager.getState();
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stop();
    this.physics.destroy();
  }
}
