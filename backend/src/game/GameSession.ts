/**
 * GameSession - Server-side game loop (ported from NetworkedGame host logic)
 */

import Matter from 'matter-js';
import { PhysicsEngine } from '@shared/physics/PhysicsEngine';
import { Contraption, blockFromData } from '@shared/contraptions';
import { InputRegistry } from '@shared/input/InputSystem';
import { WORLD_BOUNDS } from '@shared/constants/physics';
import { getTestSpawnPosition } from '@shared/terrain/MapLoader';
import type { GameCommand, ContraptionData, UIState, GameEvent, BlockInputCommand, PlayerReadyCommand } from '@shared/types/Commands';
import type { BlockData } from '@shared/contraptions/blocks/BaseBlock';
import { BaseBlock } from '@shared/contraptions/blocks/BaseBlock';
import { ServerEffectQueue, type EffectEvent } from './ServerEffectQueue';

// Extended Matter.js types
interface ExtendedBody extends Matter.Body {
  customId?: string;
  ownerId?: string;
}

interface SerializableBody {
  id: string;
  blockType?: 'wheel' | 'spike' | 'core' | 'simple' | 'gray' | 'tnt' | 'rocket' | 'hinge';
  bodyIndex?: number;
  position: { x: number; y: number };
  angle: number;
  velocity?: { x: number; y: number };
  angularVelocity?: number;
  isStatic: boolean;
  render: {
    fillStyle: string;
    healthPercent?: number;
  };
  ownerId?: string;
  label?: string;
  // Static sprite metadata (only sent once per body)
  spriteId?: string;  // format: "sheet:row" (no column)
  spriteOffsetX?: number;
  spriteOffsetY?: number;
  spriteFlipX?: boolean;
  spriteFlipY?: boolean;
  spriteWidth?: number;
  spriteHeight?: number;
  // Dynamic sprite data (sent every frame)
  spriteCol?: number;
  groundColor?: string;
  contraptionDirection?: number;
}

interface SerializableConstraint {
  id: string;
  bodyAId?: string;
  bodyBId?: string;
  pointA: { x: number; y: number };
  pointB: { x: number; y: number };
  length?: number;
  stiffness?: number;
  damping?: number;
}

export interface NetworkSnapshot {
  timestamp: number;
  tick: number;
  bodies: SerializableBody[];
  constraints?: SerializableConstraint[];
  effects?: EffectEvent[];
}

export interface GameSessionCallbacks {
  onStateUpdate: (state: NetworkSnapshot) => void;
  onUIUpdate: (uiState: UIState) => void;
  onEvent: (event: GameEvent) => void;
}

export class GameSession {
  private lobbyId: string;
  private players: string[] = [];
  private physics: PhysicsEngine;
  private callbacks: GameSessionCallbacks;
  private effectQueue: ServerEffectQueue;
  
  private isRunning = false;
  private gameLoopInterval: ReturnType<typeof setInterval> | null = null;
  
  // Tick and sync tracking
  private snapshotTick = 0;
  private lastSyncTime = 0;
  private syncInterval = 50; // 20Hz
  private lastUISyncTime = 0;
  private uiSyncInterval = 200;
  
  // Body tracking for delta sync
  private sentBodies: Set<string> = new Set();
  
  // Ready states
  private readyStates: Map<string, boolean> = new Map();
  private bothPlayersReady = false;
  
  // Countdown state
  private countdownActive = false;
  private countdownTimeoutId: ReturnType<typeof setTimeout> | null = null;
  
  // Win state
  private winState: { winner: string; loser: string } | null = null;
  

  constructor(lobbyId: string, players: string[], callbacks: GameSessionCallbacks) {
    this.lobbyId = lobbyId;
    this.players = players;
    this.callbacks = callbacks;
    
    this.physics = new PhysicsEngine({ isServer: true });
    this.effectQueue = new ServerEffectQueue();
    this.physics.setEffectManager(this.effectQueue);
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    
    // Start physics (will be paused during countdown)
    this.physics.start();
    
    // Start game loop at 60Hz
    this.gameLoopInterval = setInterval(() => this.gameLoop(), 1000 / 60);
  }

  stop(): void {
    this.isRunning = false;
    if (this.gameLoopInterval) {
      clearInterval(this.gameLoopInterval);
      this.gameLoopInterval = null;
    }
    if (this.countdownTimeoutId) {
      clearTimeout(this.countdownTimeoutId);
      this.countdownTimeoutId = null;
    }
  }

  destroy(): void {
    this.stop();
    this.physics.destroy();
  }

  handleCommand(command: GameCommand): void {
    switch (command.type) {
      case 'player-init':
        // Legacy - spawn client's contraption if provided
        if (command.contraption) {
          const playerIndex = this.players.indexOf(command.playerId);
          const x = playerIndex === 0 ? WORLD_BOUNDS.WIDTH * 0.15 : WORLD_BOUNDS.WIDTH * 0.85;
          const y = 300;
          this.spawnContraption(x, y, command.playerId, command.contraption);
        }
        break;
        
      case 'player-ready':
        {
          const c = command as PlayerReadyCommand;
          this.readyStates.set(c.playerId, true);
          
          if (c.contraption) {
            const playerIndex = this.players.indexOf(c.playerId);
            const x = playerIndex === 0 ? WORLD_BOUNDS.WIDTH * 0.15 : WORLD_BOUNDS.WIDTH * 0.85;
            const y = 200;
            this.spawnContraption(x, y, c.playerId, c.contraption);
          }
          
          const allReady = Array.from(this.readyStates.values()).every(v => v === true) && this.readyStates.size >= 2;
          if (allReady && !this.countdownActive) {
            this.startCountdown();
            this.callbacks.onEvent({ type: 'countdown-start' });
          }
        }
        break;
        
      case 'block-input':
        {
          const c = command as BlockInputCommand;
          const binding = InputRegistry.getById(c.bindingId);
          if (binding) {
            console.log(`[GameSession] Applying input: bindingId=${c.bindingId}, phase=${c.phase}, playerId=${c.playerId}`);
            binding.apply({ role: 'host', playerId: c.playerId, physics: this.physics }, c.phase, c.payload);
          }
        }
        break;
        
      case 'spawn-box':
        this.spawnContraption(command.position.x, command.position.y, command.playerId, command.contraption);
        break;
    }
  }

  private startCountdown(): void {
    if (this.countdownActive) return;
    
    this.countdownActive = true;
    this.physics.stop();
    
    // Nested timeouts for countdown: 3, 2, 1, FIGHT
    this.countdownTimeoutId = setTimeout(() => {
      this.countdownTimeoutId = setTimeout(() => {
        this.countdownTimeoutId = setTimeout(() => {
          this.countdownTimeoutId = setTimeout(() => {
            this.countdownActive = false;
            this.bothPlayersReady = true;
            this.physics.start();
            this.physics.enableMapShrinking();
            this.countdownTimeoutId = null;
          }, 1000);
        }, 1000);
      }, 1000);
    }, 1000);
  }

  private spawnContraption(x: number, y: number, playerId: string, contraptionData: ContraptionData): void {
    // Always assign direction based on join order: first player (index 0) faces right (direction 1),
    // second player (index 1) faces left (direction -1)
    const playerIndex = this.players.indexOf(playerId);
    const direction = playerIndex === 0 ? 1 : -1;
    const team = playerId;
    
    const mapWidth = WORLD_BOUNDS.WIDTH;
    const zone = mapWidth * 0.15;
    const clampedX = playerIndex === 0
      ? Math.max(0, Math.min(zone, x))
      : Math.max(mapWidth - zone, Math.min(mapWidth, x));

    const contraption = new Contraption(
      `${contraptionData.id}-${Date.now()}`,
      contraptionData.name,
      direction,
      team,
      false,
      contraptionData.vehicleClass
    );
    
    contraptionData.blocks.forEach(blockData => {
      const block = blockFromData(blockData as BlockData);
      contraption.addBlock(block);
    });
    
    this.physics.registerContraption(contraption);
    
    const spawnPos = getTestSpawnPosition(undefined, contraptionData.vehicleClass);
    const spawnY = spawnPos.y;
    
    const { bodies, constraints } = contraption.buildPhysics(clampedX, spawnY);
    
    bodies.forEach(body => {
      (body as ExtendedBody).ownerId = playerId;
      this.physics.addBody(body);
    });
    constraints.forEach(constraint => this.physics.addConstraint(constraint));
  }

  private gameLoop(): void {
    if (!this.isRunning) return;

    const now = Date.now();

    // Increment tick
    this.snapshotTick++;

    // Send physics state at sync interval
    if (now - this.lastSyncTime >= this.syncInterval) {
      const state = this.serializeState();
      if (state) {
        this.callbacks.onStateUpdate(state);
        this.lastSyncTime = now;
      }
    }

    // Send UI state
    if (now - this.lastUISyncTime >= this.uiSyncInterval) {
      const uiState = this.serializeUIState();
      this.callbacks.onUIUpdate(uiState);
      this.lastUISyncTime = now;
    }

    // Check win condition
    if (this.bothPlayersReady && !this.winState) {
      this.checkWinCondition();
    }
  }

  private serializeState(): NetworkSnapshot | null {
    const allBodies = this.physics.getAllBodies();
    const idByBody = new Map<Matter.Body, string>();
    
    const snapshot: NetworkSnapshot = {
      timestamp: Date.now(),
      tick: this.snapshotTick,
      bodies: allBodies.map(body => {
        const id = (body as ExtendedBody).customId || `static-${body.id}`;
        const isNew = !this.sentBodies.has(id);
        
        if (isNew) {
          this.sentBodies.add(id);
        }

        idByBody.set(body, id);
        
        const block = (body as unknown as { block?: BaseBlock }).block;
        const isGround = body.isStatic && body.label === 'ground';
        
        // Static sprite metadata (only needs to be sent once per body)
        let spriteId: string | undefined;
        let spriteOffsetX: number | undefined;
        let spriteOffsetY: number | undefined;
        let spriteFlipX: boolean | undefined;
        let spriteFlipY: boolean | undefined;
        let spriteWidth: number | undefined;
        let spriteHeight: number | undefined;
        // Dynamic sprite column (sent every frame)
        const spriteCol = (body as unknown as { spriteCol?: number }).spriteCol;
        
        if (!isGround) {
          const existingSprite = (body as unknown as { sprite?: { sheet: string; row: number; offsetX?: number; offsetY?: number; flipX?: boolean; flipY?: boolean; width?: number; height?: number } }).sprite;
          if (existingSprite) {
            // spriteId is just sheet:row (no column - that's sent separately)
            spriteId = `${existingSprite.sheet}:${existingSprite.row}`;
            spriteOffsetX = existingSprite.offsetX;
            spriteOffsetY = existingSprite.offsetY;
            spriteFlipX = existingSprite.flipX;
            spriteFlipY = existingSprite.flipY;
            spriteWidth = existingSprite.width;
            spriteHeight = existingSprite.height;
          } else if (block) {
            const sheet = block.getSpritesheetName();
            const row = block.getSpriteRow();
            if (sheet) {
              spriteId = `${sheet}:${row}`;
              const offset = block.getSpriteOffset();
              spriteOffsetX = offset.x;
              spriteOffsetY = offset.y;
              const size = block.getSpriteSize();
              spriteWidth = size.width;
              spriteHeight = size.height;
            }
          }
        }
        
        let blockType: 'wheel' | 'spike' | 'core' | 'simple' | 'gray' | 'tnt' | 'rocket' | 'hinge' | undefined;
        let bodyIndex: number | undefined;
        
        const label = body.label || '';
        
        if (block && !isGround) {
          blockType = block.type as 'wheel' | 'spike' | 'core' | 'simple' | 'gray' | 'tnt' | 'rocket' | 'hinge';
          if (label.includes('-wheel') || label.includes('wheel-circle')) bodyIndex = 1;
          else if (label.includes('-attach-bottom') || label.includes('hinge-attach-bottom')) bodyIndex = 1;
          else if (label.includes('-hinge') || label.includes('hinge-circle')) bodyIndex = 2;
          else bodyIndex = 0;
        } else if (!isGround) {
          if (label.startsWith('wheel-')) {
            blockType = 'wheel';
            if (label.includes('-wheel')) bodyIndex = 1;
            else if (label.includes('-attach')) bodyIndex = 0;
          } else if (label.startsWith('spike-')) {
            blockType = 'spike';
            if (label.includes('-wheel')) bodyIndex = 1;
            else bodyIndex = 0;
          } else if (label.startsWith('hinge-')) {
            blockType = 'hinge';
            if (label.includes('-hinge') || label.includes('hinge-circle')) bodyIndex = 2;
            else if (label.includes('-attach-bottom') || label.includes('hinge-attach-bottom')) bodyIndex = 1;
            else bodyIndex = 0;
          } else if (label.startsWith('core-') || label === 'core') {
            blockType = 'core';
            bodyIndex = 0;
          } else if (label.startsWith('simple-') || label === 'simple') {
            blockType = 'simple';
            bodyIndex = 0;
          } else if (label.startsWith('gray-') || label === 'gray') {
            blockType = 'gray';
            bodyIndex = 0;
          } else if (label.startsWith('tnt-') || label === 'tnt') {
            blockType = 'tnt';
            bodyIndex = 0;
          } else if (label.startsWith('rocket-') || label === 'rocket') {
            blockType = 'rocket';
            bodyIndex = 0;
          }
        }
        
        return {
          id,
          blockType,
          bodyIndex,
          position: { x: body.position.x, y: body.position.y },
          angle: body.angle,
          velocity: { x: body.velocity.x, y: body.velocity.y },
          angularVelocity: body.angularVelocity,
          isStatic: body.isStatic,
          render: {
            fillStyle: (body.render as Matter.IBodyRenderOptions)?.fillStyle || (body.isStatic ? '#555555' : '#3498db'),
            healthPercent: (() => {
              if (block && block.maxHealth > 0) {
                return Math.max(0, Math.min(1, block.health / block.maxHealth));
              }
              return undefined;
            })(),
          },
          ownerId: (body as ExtendedBody).ownerId || undefined,
          label: body.label || undefined,
          spriteId: spriteId || undefined,
          spriteOffsetX: spriteOffsetX !== undefined ? spriteOffsetX : undefined,
          spriteOffsetY: spriteOffsetY !== undefined ? spriteOffsetY : undefined,
          spriteFlipX: spriteFlipX !== undefined ? spriteFlipX : undefined,
          spriteFlipY: spriteFlipY !== undefined ? spriteFlipY : undefined,
          spriteWidth: spriteWidth !== undefined ? spriteWidth : undefined,
          spriteHeight: spriteHeight !== undefined ? spriteHeight : undefined,
          spriteCol,  // Dynamic - sent every frame
          groundColor: isGround && isNew ? ((body.render as Matter.IBodyRenderOptions)?.fillStyle || '#555555') : undefined,
          contraptionDirection: (body as unknown as { contraptionDirection?: number }).contraptionDirection,
        };
      }),
      effects: undefined, // Will be set below
    };

    // Drain effect events from the queue
    const effects = this.effectQueue.drain();
    if (effects.length > 0) {
      snapshot.effects = effects;
    }

    const constraints = this.physics.getAllConstraints();
    if (constraints.length > 0) {
      const serializedConstraints: SerializableConstraint[] = [];
      constraints.forEach(constraint => {
        const bodyAId = constraint.bodyA ? idByBody.get(constraint.bodyA) : undefined;
        const bodyBId = constraint.bodyB ? idByBody.get(constraint.bodyB) : undefined;
        const pointA = constraint.pointA ? { x: constraint.pointA.x, y: constraint.pointA.y } : { x: 0, y: 0 };
        const pointB = constraint.pointB ? { x: constraint.pointB.x, y: constraint.pointB.y } : { x: 0, y: 0 };

        serializedConstraints.push({
          id: `constraint-${constraint.id}`,
          bodyAId,
          bodyBId,
          pointA,
          pointB,
          length: constraint.length,
          stiffness: constraint.stiffness,
          damping: constraint.damping,
        });
      });

      if (serializedConstraints.length > 0) {
        snapshot.constraints = serializedConstraints;
      }
    }
    
    const currentBodyIds = new Set(snapshot.bodies.map(b => b.id));
    this.sentBodies.forEach(id => {
      if (!currentBodyIds.has(id)) {
        this.sentBodies.delete(id);
      }
    });
    
    return snapshot;
  }

  private serializeUIState(): UIState {
    return { resources: {}, cooldowns: {} };
  }

  private checkWinCondition(): void {
    if (this.winState) return;
    if (this.players.length < 2) return;
    
    const [player1, player2] = this.players;
    const bodies = this.physics.getAllBodies();
    
    const coresPerPlayer = new Map<string, number>();
    coresPerPlayer.set(player1, 0);
    coresPerPlayer.set(player2, 0);
    
    bodies.forEach(body => {
      const block = (body as unknown as { block?: { type?: string } }).block;
      if (block?.type === 'core') {
        const ownerId = (body as ExtendedBody).ownerId;
        if (ownerId) {
          coresPerPlayer.set(ownerId, (coresPerPlayer.get(ownerId) || 0) + 1);
        }
      }
    });
    
    const player1HasCore = (coresPerPlayer.get(player1) || 0) > 0;
    const player2HasCore = (coresPerPlayer.get(player2) || 0) > 0;
    
    if (!player1HasCore && player2HasCore) {
      this.winState = { winner: player2, loser: player1 };
      this.callbacks.onEvent({ type: 'game-over', winner: player2, loser: player1 });
    } else if (player1HasCore && !player2HasCore) {
      this.winState = { winner: player1, loser: player2 };
      this.callbacks.onEvent({ type: 'game-over', winner: player1, loser: player2 });
    }
  }

  getWinState(): { winner: string; loser: string } | null {
    return this.winState;
  }
}

