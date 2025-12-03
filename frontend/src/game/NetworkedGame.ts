/**
 * Networked Game - Client-side game with server-authoritative physics
 * All physics runs on server; clients do prediction and reconciliation
 */

import { PhysicsEngine } from '@shared/physics/PhysicsEngine';
import { Renderer } from '@/rendering/Renderer';
import { NetworkManager } from '@/core/networking/NetworkManager';
import type { GameCommand, UIState, GameEvent, BlockInputCommand, PlayerReadyCommand } from '@shared/types/Commands';
import type { GameState } from '@shared/types/GameState';
import Matter from 'matter-js';
import { BLOCK_REGISTRY } from '@shared/contraptions';
import type { ContraptionSaveData } from '@shared/contraptions/Contraption';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';
import { InputController } from '@/game/input/InputSystem';

// Extended Matter.js types for our use case
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

interface EffectEvent {
  type: 'impact' | 'damage' | 'tint' | 'explosion' | 'building';
  x: number;
  y: number;
  damage?: number;
  bodyId?: number;
  vx?: number;
  vy?: number;
  radius?: number;
  durationMs?: number;
  playerId?: string;
}

interface NetworkSnapshot {
  timestamp: number;
  tick: number;
  bodies: SerializableBody[];
  constraints?: SerializableConstraint[];
  effects?: EffectEvent[];
  _receivedAt?: number;
}

interface NetworkedGameConfig {
  canvas: HTMLCanvasElement;
  lobbyId: string;
  playerId: string;
  playerIndex: number; // 0 = first player (left side), 1 = second player (right side)
  contraption?: ContraptionSaveData;
  onContraptionSpawned?: () => void;
  onReturnToMenu?: () => void;
  onUIUpdate?: (ui: UIState) => void;
}

export class NetworkedGame {
  private canvas: HTMLCanvasElement;
  private playerId: string;
  private playerIndex: number;
  
  private physics: PhysicsEngine | null = null;
  private renderer: Renderer;
  private network: NetworkManager;
  private onContraptionSpawned?: () => void;
  private onReturnToMenu?: () => void;
  private onUIUpdateCb?: (ui: UIState) => void;
  private savedContraption: ContraptionSaveData | null = null;
  
  private isRunning = false;
  private animationFrameId: number | null = null;
  
  // Track bodies for state sync
  private bodies: Map<string, ExtendedBody> = new Map();
  
  // Tick tracking for snapshot sequencing
  private lastReceivedTick = 0;
  
  // Client-side: cache owner/label/sprite metadata (sent once per body)
  private ownerCache: Map<string, string> = new Map();
  private labelCache: Map<string, string> = new Map();
  private spriteIdCache: Map<string, string> = new Map();
  private spriteOffsetXCache: Map<string, number> = new Map();
  private spriteOffsetYCache: Map<string, number> = new Map();
  private spriteFlipXCache: Map<string, boolean> = new Map();
  private spriteFlipYCache: Map<string, boolean> = new Map();
  private spriteWidthCache: Map<string, number> = new Map();
  private spriteHeightCache: Map<string, number> = new Map();
  private groundColorCache: Map<string, string> = new Map();
  private bodySizeCache: Map<string, { width: number; height: number }> = new Map();

  // Client-side: store latest snapshot for rendering
  private latestSnapshot: NetworkSnapshot | null = null;
  private clientConstraints: Map<string, Matter.Constraint> = new Map();

  // Client-side: state buffer for delayed rendering
  private clientSimulatedTick = 0;
  private clientPendingCorrections: Map<number, NetworkSnapshot> = new Map();
  private clientPhysicsStarted = false;
  private serverFrozen = true;

  // Cooldowns per player (disabled)
  private buildCooldowns: Map<string, number> = new Map();
  
  // Track when both players are connected
  private bothPlayersConnected = false;
  
  // Countdown state
  private countdownActive = false;
  private countdownValue: number | 'FIGHT' | null = null;
  private countdownTimeoutId: number | null = null;
  
  // Win state
  private winState: { winner: string; loser: string } | null = null;
  private displayWinState: { winner: string; loser: string } | null = null;
  private winDelayTimeoutId: number | null = null;
  
  public energy: number = 0;

  private inputController: InputController | null = null;

  // Client-side: Store the distance off of target for the last 5 snapshots
  private lastNSnapshotDistances: number[] = [];
  private readonly DistanceAverageWindow = 15;
  private readonly ALLOWED_DEVIATION = 3;
  private readonly BUFFER_TICKS = 4;


  constructor(config: NetworkedGameConfig) {
    this.canvas = config.canvas;
    this.playerId = config.playerId;
    this.playerIndex = config.playerIndex;
    this.savedContraption = config.contraption || null;
    this.onContraptionSpawned = config.onContraptionSpawned;
    this.onReturnToMenu = config.onReturnToMenu;
    this.onUIUpdateCb = config.onUIUpdate;
    
    this.energy = 0;
    
    // Initialize renderer
    this.renderer = new Renderer(this.canvas);
    this.renderer.setPlayerId(this.playerId);
    // Mirror view for second player so they perceive themselves on the right moving left
    if (this.playerIndex === 1) {
      this.renderer.camera.mirrorX = true;
    }
    this.renderer.camera.setControlsEnabled(false);
    
    // Initialize physics for client-side prediction (no boundaries - server sends those)
    this.physics = new PhysicsEngine({ createBoundaries: false });
    this.physics.setEffectManager(this.renderer.effects);
    
    // Initialize networking
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const signalingUrl = (import.meta.env.VITE_SIGNALING_URL || import.meta.env.VITE_SIGNALING_SERVER || (
      import.meta.env.DEV
        ? `${protocol}//${window.location.hostname}:3001`
        : `${protocol}//${window.location.host}`
    )) + '/ws';
    
    this.network = new NetworkManager({
      lobbyId: config.lobbyId,
      playerId: config.playerId,
      signalingServerUrl: signalingUrl,
      onStateUpdate: (state) => this.handleStateUpdate(state),
      onUIUpdate: (uiState) => this.handleUIUpdate(uiState),
      onEvent: (event) => this.handleEvent(event),
      onConnected: () => { 
        this.bothPlayersConnected = true;
      },
      onDisconnected: () => { 
        this.bothPlayersConnected = false;
      },
    });

    // Input controller setup - all inputs go to server
    const sendGeneric = (bindingId: string, phase: 'press' | 'release' | 'change', payload?: { [k: string]: unknown }) => {
      const cmd: BlockInputCommand = { type: 'block-input', playerId: this.playerId, bindingId, phase, payload };
      this.network.sendCommand(cmd as unknown as GameCommand);
    };
    this.inputController = new InputController({ 
      role: 'client', 
      playerId: this.playerId, 
      sendCommand: sendGeneric, 
      physics: null, // No local physics for inputs - server handles it
      effects: this.renderer.effects 
    });
    this.inputController.attach();
  }

  /**
   * Start the countdown sequence (3, 2, 1, FIGHT) - triggered by server event
   */
  private startCountdown(): void {
    if (this.countdownActive) return;
    
    this.countdownActive = true;
    this.countdownValue = 3;
    
    if (this.countdownTimeoutId !== null) {
      window.clearTimeout(this.countdownTimeoutId);
    }
    
    this.countdownTimeoutId = window.setTimeout(() => {
      this.countdownValue = 2;
      this.countdownTimeoutId = window.setTimeout(() => {
        this.countdownValue = 1;
        this.countdownTimeoutId = window.setTimeout(() => {
          this.countdownValue = 'FIGHT';
          this.countdownTimeoutId = window.setTimeout(() => {
            this.countdownActive = false;
            this.countdownValue = null;
            
            if (this.countdownTimeoutId !== null) {
              window.clearTimeout(this.countdownTimeoutId);
              this.countdownTimeoutId = null;
            }
          }, 1000);
        }, 1000);
      }, 1000);
    }, 1000);
  }

  /**
   * Handle state update from server - Physics Channel
   */
  private handleStateUpdate(state: GameState): void {
    const snapshot = { ...(state as unknown as NetworkSnapshot), _receivedAt: Date.now() } as NetworkSnapshot;
    
    this.lastReceivedTick = snapshot.tick;
    
    // If server is frozen, directly apply the latest snapshot for rendering without stepping physics.
    // This keeps visuals accurate while everything stays still.
    if (this.serverFrozen) {
      this.applyClientSnapshot(snapshot);
      // Keep clientSimulatedTick aligned to the latest snapshot so we don't accumulate buffer
      this.clientSimulatedTick = Math.max(this.clientSimulatedTick, snapshot.tick);
      return;
    }
    
    // Start client physics only when server is not frozen
    if (!this.clientPhysicsStarted && this.physics && !this.serverFrozen) {
      this.physics.start();
      this.clientPhysicsStarted = true;
      this.clientSimulatedTick = Math.max(0, snapshot.tick);
    }
    
    this.lastNSnapshotDistances.push(snapshot.tick - this.clientSimulatedTick);
    if (this.lastNSnapshotDistances.length > this.DistanceAverageWindow) {
      this.lastNSnapshotDistances.shift();
    }
    
    const averageDistance = this.lastNSnapshotDistances.reduce((a, b) => a + b, 0) / this.lastNSnapshotDistances.length;
    
    if (averageDistance - this.BUFFER_TICKS > this.ALLOWED_DEVIATION) {
      this.clientSimulatedTick += 1;
      this.lastNSnapshotDistances = this.lastNSnapshotDistances.map(d => d - 1);
    } else if (averageDistance - this.BUFFER_TICKS < -this.ALLOWED_DEVIATION) {
      this.clientSimulatedTick -= 1;
      this.lastNSnapshotDistances = this.lastNSnapshotDistances.map(d => d + 1);
    }
    
    if (snapshot.tick > this.clientSimulatedTick) {
      this.clientPendingCorrections.set(snapshot.tick, snapshot);
    } else {
      return;
    }
    
    // Cache metadata (sent once per body)
    snapshot.bodies.forEach(body => {
      if (body.ownerId && !this.ownerCache.has(body.id)) this.ownerCache.set(body.id, body.ownerId);
      if (body.label && !this.labelCache.has(body.id)) this.labelCache.set(body.id, body.label);
      if (body.spriteId) this.spriteIdCache.set(body.id, body.spriteId);
      if (body.spriteOffsetX !== undefined && !this.spriteOffsetXCache.has(body.id)) this.spriteOffsetXCache.set(body.id, body.spriteOffsetX);
      if (body.spriteOffsetY !== undefined && !this.spriteOffsetYCache.has(body.id)) this.spriteOffsetYCache.set(body.id, body.spriteOffsetY);
      if (body.spriteFlipX !== undefined && !this.spriteFlipXCache.has(body.id)) this.spriteFlipXCache.set(body.id, body.spriteFlipX);
      if (body.spriteFlipY !== undefined && !this.spriteFlipYCache.has(body.id)) this.spriteFlipYCache.set(body.id, body.spriteFlipY);
      if (body.spriteWidth !== undefined && !this.spriteWidthCache.has(body.id)) this.spriteWidthCache.set(body.id, body.spriteWidth);
      if (body.spriteHeight !== undefined && !this.spriteHeightCache.has(body.id)) this.spriteHeightCache.set(body.id, body.spriteHeight);
      if (body.groundColor && !this.groundColorCache.has(body.id)) this.groundColorCache.set(body.id, body.groundColor);
    });
    
    this.latestSnapshot = snapshot;

    // Process effect events
    if (snapshot.effects) {
      snapshot.effects.forEach(effect => {
        switch (effect.type) {
          case 'impact':
            this.renderer.effects.spawnImpactParticles(effect.x, effect.y, effect.damage || 0, effect.vx || 0, effect.vy || 0);
            break;
          case 'damage':
            this.renderer.effects.spawnDamageNumber(effect.x, effect.y, effect.damage || 0);
            break;
          case 'tint':
            if (effect.bodyId !== undefined) {
              this.renderer.effects.applyBlockTint(effect.bodyId, effect.damage || 0);
            }
            break;
          case 'explosion':
            this.renderer.effects.spawnExplosionFlash(effect.x, effect.y, effect.radius || 40, effect.durationMs || 200);
            break;
          case 'building':
            this.renderer.effects.spawnBuildingDust(effect.x, effect.y, effect.durationMs || 500, effect.radius || 50);
            if (effect.playerId) {
              this.buildCooldowns.set(effect.playerId, Date.now() + (effect.durationMs || 500));
            }
            break;
        }
      });
    }
  }

  private applyClientSnapshot(snapshot: NetworkSnapshot): void {
    if (!this.physics) return;

    const physics = this.physics;

    this.clientConstraints.forEach(constraint => physics.removeConstraint(constraint));
    this.clientConstraints.clear();

    this.bodies.forEach(body => physics.removeBody(body));
    this.bodies.clear();

    const bodyMap = new Map<string, ExtendedBody>();

    snapshot.bodies.forEach(bodyState => {
      const isGround = bodyState.isStatic && bodyState.label === 'ground';
      
      let created: Matter.Body;
      
      if (bodyState.blockType && bodyState.bodyIndex !== undefined) {
        const BlockClass = BLOCK_REGISTRY[bodyState.blockType];
        const specs = BlockClass.getBodySpecs();
        const spec = specs[bodyState.bodyIndex];
        
        if (!spec) {
          console.warn(`Unknown body spec for ${bodyState.blockType} body ${bodyState.bodyIndex}`);
          return;
        }
        
        const options: Matter.IBodyDefinition = { ...spec.options };
        
        if (spec.shape === 'circle') {
          created = Matter.Bodies.circle(bodyState.position.x, bodyState.position.y, spec.radius!, options);
        } else if (spec.shape === 'rectangle') {
          created = Matter.Bodies.rectangle(bodyState.position.x, bodyState.position.y, spec.width!, spec.height!, options);
        } else if (spec.shape === 'polygon') {
          // For polygons (spikes), apply mirroring based on contraption direction
          const dir = bodyState.contraptionDirection ?? 1;
          const vertices = spec.vertices!.map(v => ({
            x: bodyState.position.x + v.x * dir,
            y: bodyState.position.y + v.y
          }));
          created = Matter.Bodies.fromVertices(bodyState.position.x, bodyState.position.y, [vertices], options);
        } else {
          console.warn(`Unknown body shape: ${spec.shape}`);
          return;
        }
      } else if (isGround) {
        const cachedSize = this.bodySizeCache.get(bodyState.id);
        const width = cachedSize?.width ?? BUILDER_CONSTANTS.GROUND_BLOCK_SIZE;
        const height = cachedSize?.height ?? BUILDER_CONSTANTS.GROUND_BLOCK_SIZE;
        
        const options: Matter.IBodyDefinition = {
          isStatic: bodyState.isStatic,
          label: bodyState.label,
        };
        
        created = Matter.Bodies.rectangle(bodyState.position.x, bodyState.position.y, width, height, options);
      } else if (bodyState.isStatic) {
        const cachedSize = this.bodySizeCache.get(bodyState.id);
        const width = cachedSize?.width ?? BUILDER_CONSTANTS.GROUND_BLOCK_SIZE;
        const height = cachedSize?.height ?? BUILDER_CONSTANTS.GROUND_BLOCK_SIZE;
        
        const options: Matter.IBodyDefinition = {
          isStatic: bodyState.isStatic,
          label: bodyState.label,
        };
        
        created = Matter.Bodies.rectangle(bodyState.position.x, bodyState.position.y, width, height, options);
      } else {
        console.warn(`Body ${bodyState.id} has no block type and is not ground`);
        return;
      }

      const extendedBody = created as ExtendedBody;
      extendedBody.customId = bodyState.id;
      extendedBody.ownerId = bodyState.ownerId ?? this.ownerCache.get(bodyState.id);
      (extendedBody as { label?: string }).label = bodyState.label ?? this.labelCache.get(bodyState.id) ?? extendedBody.label;

      const fill = isGround
        ? (bodyState.groundColor ?? this.groundColorCache.get(bodyState.id) ?? bodyState.render.fillStyle)
        : bodyState.render.fillStyle;
      extendedBody.render.fillStyle = fill;
      (extendedBody.render as { healthPercent?: number }).healthPercent = bodyState.render.healthPercent;

      // Static sprite metadata from snapshot or cache
      const spriteId = bodyState.spriteId ?? this.spriteIdCache.get(bodyState.id);
      if (spriteId) {
        const parts = spriteId.split(':');
        if (parts.length >= 2) {
          const sheet = parts[0];
          const row = parseInt(parts[1], 10);
          const offsetX = bodyState.spriteOffsetX ?? (this.spriteOffsetXCache.get(bodyState.id) ?? 0);
          const offsetY = bodyState.spriteOffsetY ?? (this.spriteOffsetYCache.get(bodyState.id) ?? 0);
          const flipX = bodyState.spriteFlipX ?? (this.spriteFlipXCache.get(bodyState.id) ?? false);
          const flipY = bodyState.spriteFlipY ?? (this.spriteFlipYCache.get(bodyState.id) ?? false);
          const spriteWidth = bodyState.spriteWidth ?? this.spriteWidthCache.get(bodyState.id);
          const spriteHeight = bodyState.spriteHeight ?? this.spriteHeightCache.get(bodyState.id);

          const sprite: { sheet: string; row: number; offsetX: number; offsetY: number; col?: number; flipX?: boolean; flipY?: boolean; width?: number; height?: number } = {
            sheet,
            row,
            offsetX,
            offsetY,
          };
          if (flipX) sprite.flipX = flipX;
          if (flipY) sprite.flipY = flipY;
          if (spriteWidth !== undefined) sprite.width = spriteWidth;
          if (spriteHeight !== undefined) sprite.height = spriteHeight;

          (extendedBody as unknown as { sprite?: typeof sprite }).sprite = sprite;
        }
      }
      
      // Dynamic spriteCol - only server sets this, client just reads it
      (extendedBody as unknown as { spriteCol?: number }).spriteCol = bodyState.spriteCol ?? 0;

      const velocity = bodyState.velocity ?? { x: 0, y: 0 };

      Matter.Body.setPosition(extendedBody, bodyState.position);
      Matter.Body.setAngle(extendedBody, bodyState.angle);
      Matter.Body.setVelocity(extendedBody, velocity);
      Matter.Body.setAngularVelocity(extendedBody, bodyState.angularVelocity ?? 0);

      extendedBody.force.x = 0;
      extendedBody.force.y = 0;
      extendedBody.torque = 0;
      Matter.Sleeping.set(extendedBody, false);

      physics.addBody(extendedBody);
      this.bodies.set(bodyState.id, extendedBody);
      bodyMap.set(bodyState.id, extendedBody);
    });

    const serializedConstraints = snapshot.constraints ?? [];
    serializedConstraints.forEach(data => {
      const bodyA = data.bodyAId ? bodyMap.get(data.bodyAId) : undefined;
      const bodyB = data.bodyBId ? bodyMap.get(data.bodyBId) : undefined;

      if ((data.bodyAId && !bodyA) || (data.bodyBId && !bodyB)) {
        return;
      }

      const constraintOptions: Matter.IConstraintDefinition = {
        pointA: { x: data.pointA.x, y: data.pointA.y },
        pointB: { x: data.pointB.x, y: data.pointB.y },
        length: data.length,
        stiffness: data.stiffness,
        damping: data.damping,
      };

      if (bodyA) constraintOptions.bodyA = bodyA;
      if (bodyB) constraintOptions.bodyB = bodyB;

      const constraint = Matter.Constraint.create(constraintOptions);
      physics.addConstraint(constraint);
      this.clientConstraints.set(data.id, constraint);
    });
  }

  /**
   * Handle UI update from server - UI Channel
   */
  private handleUIUpdate(uiState: UIState): void {
    if (this.onUIUpdateCb) {
      this.onUIUpdateCb(uiState);
    }
  }

  /**
   * Handle game event from server - Events Channel
   */
  private handleEvent(event: GameEvent): void {
    switch (event.type) {
      case 'player-joined':
        break;
      case 'freeze':
        this.serverFrozen = true;
        if (this.physics) {
          this.physics.stop();
        }
        this.clientPhysicsStarted = false;
        break;
      case 'unfreeze':
        // Allow physics to start on the next state update to sync tick
        this.serverFrozen = false;
        break;
      case 'countdown-start':
        this.startCountdown();
        break;
      case 'game-over':
        this.winState = { winner: event.winner, loser: event.loser };
        // Delay displaying win screen by 2000ms to let players see final moments
        if (this.winDelayTimeoutId !== null) {
          window.clearTimeout(this.winDelayTimeoutId);
        }
        this.winDelayTimeoutId = window.setTimeout(() => {
          this.displayWinState = this.winState;
          this.winDelayTimeoutId = null;
        }, 2000);
        break;
    }
  }

  /**
   * Start the game loop
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.gameLoop();
  }

  /**
   * Check if the game is running
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Capture current client simulation state for buffering
   */
  private captureClientState(): void {
    if (!this.physics) return;
    
    // Check if there's a pending correction for the current tick and apply it
    if (this.clientPendingCorrections.has(this.clientSimulatedTick)) {
      const correction = this.clientPendingCorrections.get(this.clientSimulatedTick)!;
      this.clientPendingCorrections.delete(this.clientSimulatedTick);
      this.applyClientSnapshot(correction);
    }
    
    this.clientSimulatedTick++;
  }

  /**
   * Main game loop
   */
  private gameLoop = (): void => {
    if (!this.isRunning) return;

    // Client: record simulation state to buffer
    if (this.clientPhysicsStarted) {
      this.captureClientState();
    }

    // Render
    if (this.physics) {
      this.renderer.renderPhysics(this.physics.getAllBodies());
    }

    // Render countdown overlay
    this.renderCountdown();

    // Render win screen
    this.renderWinScreen();

    this.animationFrameId = requestAnimationFrame(this.gameLoop);
  };

  /**
   * Render countdown overlay
   */
  private renderCountdown(): void {
    if (!this.countdownValue) return;
    
    const ctx = this.renderer.getContext();
    const width = this.canvas.width;
    const height = this.canvas.height;
    
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fontSize = Math.min(width, height) * 0.15;
    ctx.font = `bold ${fontSize}px Arial`;
    
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    if (typeof this.countdownValue === 'number') {
      ctx.fillStyle = '#ffffff';
      ctx.fillText(this.countdownValue.toString(), width / 2, height / 2);
    } else if (this.countdownValue === 'FIGHT') {
      ctx.fillStyle = '#ff0000';
      const fightFontSize = Math.min(width, height) * 0.12;
      ctx.font = `bold ${fightFontSize}px Arial`;
      ctx.fillText('FIGHT!', width / 2, height / 2);
    }
    
    ctx.restore();
  }

  /**
   * Render win/loss overlay
   */
  private renderWinScreen(): void {
    if (!this.displayWinState) return;
    
    const ctx = this.renderer.getContext();
    const width = this.canvas.width;
    const height = this.canvas.height;
    
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, width, height);
    
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fontSize = Math.min(width, height) * 0.1;
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    if (this.displayWinState.winner === this.playerId) {
      ctx.fillStyle = '#00ff00';
      ctx.fillText('YOU WIN!', width / 2, height / 2);
    } else {
      ctx.fillStyle = '#ff0000';
      ctx.fillText('YOU LOST!', width / 2, height / 2);
    }
    
    ctx.restore();
  }

  /**
   * Get the current win state
   */
  getWinState(): { winner: string; loser: string } | null {
    return this.displayWinState;
  }

  /**
   * Stop the game
   */
  stop(): void {
    this.isRunning = false;
    
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stop();
    if (this.countdownTimeoutId !== null) {
      window.clearTimeout(this.countdownTimeoutId);
      this.countdownTimeoutId = null;
    }
    if (this.winDelayTimeoutId !== null) {
      window.clearTimeout(this.winDelayTimeoutId);
      this.winDelayTimeoutId = null;
    }
    if (this.physics && this.clientConstraints.size > 0) {
      this.clientConstraints.forEach(constraint => this.physics!.removeConstraint(constraint));
      this.clientConstraints.clear();
    }
    this.physics?.destroy();
    this.renderer.destroy();
    this.network.disconnect();
    this.inputController?.detach();
  }

  setSelectedContraption(data: ContraptionSaveData | null): void {
    if (data) this.savedContraption = data;
  }

  sendReadyCommand(cmd: PlayerReadyCommand): void {
    this.network.sendCommand(cmd as unknown as GameCommand);
  }
  
  sendBuildReady(contraption?: ContraptionSaveData | null): void {
    const payload = contraption ? { ...contraption } : undefined;
    const cmd = { type: 'build-ready', playerId: this.playerId, contraption: payload } as unknown as GameCommand;
    this.network.sendCommand(cmd);
  }
  
  sendBuildLock(contraption?: ContraptionSaveData | null): void {
    const finalContraption = contraption ? { ...contraption } : {
      id: 'empty',
      name: 'Empty',
      blocks: [],
      vehicleClass: 'medium' as const
    };
    const cmd = { type: 'build-lock', playerId: this.playerId, contraption: finalContraption } as unknown as GameCommand;
    this.network.sendCommand(cmd);
  }

  getPlayerResources(_playerId: string): { energy: number } | null { return null; }
  getMyEnergy(): number { return 0; }

  getBaseHealth(): { mine: number; enemy: number } {
    return {
      mine: 10,
      enemy: 10,
    };
  }

  /**
   * Whether the network connection to the server is established
   */
  isConnected(): boolean {
    return this.network.isConnected();
  }
}
