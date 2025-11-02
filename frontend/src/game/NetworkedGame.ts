/**
 * Networked Game - Handles both host and client modes
 */

import { PhysicsEngine } from '@/core/physics/PhysicsEngine';
import { Renderer } from '@/rendering/Renderer';
import { NetworkManager, NetworkRole } from '@/core/networking/NetworkManager';
import type { GameCommand, ContraptionData, UIState, GameEvent, BlockInputCommand, PlayerReadyCommand } from '@shared/types/Commands';
import type { GameState } from '@shared/types/GameState';
import type * as Matter from 'matter-js';
import { Contraption, blockFromData } from '@/game/contraptions';
import type { ContraptionSaveData } from '@/game/contraptions/Contraption';
import type { BlockData } from '@/game/contraptions/blocks/BaseBlock';
import { BaseBlock } from '@/game/contraptions/blocks/BaseBlock';
import { WORLD_BOUNDS } from '@shared/constants/physics';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';
import { InputController, InputRegistry } from '@/game/input/InputSystem';
import { getTestSpawnPosition } from '@/game/terrain/MapLoader';

// Extended Matter.js types for our use case
interface ExtendedBody extends Matter.Body {
  customId?: string;
  ownerId?: string;
}

interface SerializableBody {
  id: string;
  position: { x: number; y: number };
  angle: number;
  circleRadius?: number;
  isStatic: boolean;
  render: {
    fillStyle: string;
    healthPercent?: number;
  };
  ownerId?: string;
  label?: string;
  // Simple sprite ID: "sheet:row" format (e.g., "blocks:0")
  spriteId?: string;
  // Sprite metadata
  spriteOffsetX?: number;
  spriteOffsetY?: number;
  spriteFlipX?: boolean;
  spriteFlipY?: boolean;
  spriteWidth?: number;
  spriteHeight?: number;
  // Color for ground blocks (client can infer size/shape)
  groundColor?: string;
  // Body dimensions (sent only for static bodies on first send)
  width?: number;
  height?: number;
  // Optional kinematics for better interpolation
  velocity?: { x: number; y: number };
  angularVelocity?: number;
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
  bodies: SerializableBody[];
  effects?: EffectEvent[];
  _receivedAt?: number;
}

interface NetworkedGameConfig {
  canvas: HTMLCanvasElement;
  role: NetworkRole;
  lobbyId: string;
  playerId: string;
  contraption?: ContraptionSaveData; // Make optional
  onContraptionSpawned?: () => void;
  onReturnToMenu?: () => void;
}

export class NetworkedGame {
  private canvas: HTMLCanvasElement;
  private role: NetworkRole;
  private playerId: string;
  
  private physics: PhysicsEngine | null = null;
  private renderer: Renderer;
  private network: NetworkManager;
  private onContraptionSpawned?: () => void;
  private onReturnToMenu?: () => void;
  private savedContraption: ContraptionSaveData | null = null;
  
  private isRunning = false;
  private animationFrameId: number | null = null;
  
  // Track bodies for state sync
  private bodies: Map<string, ExtendedBody> = new Map();
  private lastSyncTime = 0;
  private syncInterval = 50; // Send physics updates every 50ms (20 times per second)
  private lastUISyncTime = 0;
  private uiSyncInterval = 200; // Send UI updates every 100ms (10 times per second)
  
  // Effect events to sync (host only)
  private effectEvents: EffectEvent[] = [];
  
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
  
  // Host-side: track which bodies we've sent full data for
  private sentBodies: Set<string> = new Set();

  // Client-side: store latest snapshot for rendering
  private latestSnapshot: NetworkSnapshot | null = null;

  // Cooldowns per player (disabled)
  private buildCooldowns: Map<string, number> = new Map();
  
  // Track when both players are connected
  private bothPlayersConnected = false;
  
  // Track ready states (host only)
  private readyStates: Map<string, boolean> = new Map();
  private bothPlayersReady = false;
  
  // Countdown state
  private countdownActive = false;
  private countdownValue: number | 'FIGHT' | null = null;
  private countdownTimeoutId: number | null = null;
  
  // Win state
  private winState: { winner: string; loser: string } | null = null;
  private contraceptionsByPlayer: Map<string, Set<string>> = new Map(); // playerId -> set of contraption body IDs
  private playerContrapctionCores: Map<string, string> = new Map(); // playerId -> coreBodyId
  
  public energy: number = 0;

  // Host-side: schedule generic block inputs keyed by binding id
  private pendingInputs: Map<string, { playerId: string; bindingId: string; phase: 'press' | 'release' | 'change'; activateAt: number; payload?: { [k: string]: unknown } }[]> = new Map();

  private inputController: InputController | null = null;

  constructor(config: NetworkedGameConfig) {
    this.canvas = config.canvas;
    this.role = config.role;
    this.playerId = config.playerId;
    this.savedContraption = config.contraption || null;
    this.onContraptionSpawned = config.onContraptionSpawned;
    this.onReturnToMenu = config.onReturnToMenu;
    
    // No resources
    this.energy = 0;
    
    // Initialize renderer
    this.renderer = new Renderer(this.canvas);
    this.renderer.setPlayerRole(this.role);
    this.renderer.setPlayerId(this.playerId);
    // Mirror view for clients so they perceive themselves on the right moving left
    if (this.role === 'client') {
      this.renderer.camera.mirrorX = true;
    }
    // Disable manual camera controls during battle; renderer will follow player
    this.renderer.camera.setControlsEnabled(false);
    
    // Initialize physics (host only) - but don't start yet
    if (this.role === 'host') {
      this.physics = new PhysicsEngine();
      this.physics.setEffectManager(this.renderer.effects);
      this.setupEffectCapture();
      // Physics will start in onConnected callback
    }
    
    // Initialize networking
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const signalingUrl = (import.meta.env.VITE_SIGNALING_URL || import.meta.env.VITE_SIGNALING_SERVER || (
      import.meta.env.DEV
        ? `${protocol}//${window.location.hostname}:3001`
        : `${protocol}//${window.location.host}`
    )) + '/ws';
    this.network = new NetworkManager({
      role: this.role,
      lobbyId: config.lobbyId,
      signalingServerUrl: signalingUrl,
      onStateUpdate: (state) => this.handleStateUpdate(state),
      onCommand: (command) => this.handleCommand(command),
      onUIUpdate: (uiState) => this.handleUIUpdate(uiState),
      onEvent: (event) => this.handleEvent(event),
      onConnected: () => { 
        this.bothPlayersConnected = true;
        // Start physics when connection is established
        if (this.role === 'host' && this.physics) {
          this.physics.start();
        }
        // Don't spawn vehicles or enable map shrinking here - wait for ready states
      },
      onDisconnected: () => { 
        this.bothPlayersConnected = false;
      },
    });

    // Input controller setup
    const sendGeneric = (bindingId: string, phase: 'press' | 'release' | 'change', payload?: { [k: string]: unknown }) => {
      // Allow inputs to flow normally - physics is paused during countdown anyway
      if (this.role === 'host') {
        const binding = InputRegistry.getById(bindingId);
        const delay = binding?.pressDelayMs || 0;
        const when = Date.now() + (phase === 'press' ? delay : 0);
        const list = this.pendingInputs.get(bindingId) || [];
        list.push({ playerId: this.playerId, bindingId, phase, activateAt: when, payload });
        this.pendingInputs.set(bindingId, list);
      } else {
        const cmd: BlockInputCommand = { type: 'block-input', playerId: this.playerId, bindingId, phase, payload };
        this.network.sendCommand(cmd as unknown as GameCommand);
      }
    };
    this.inputController = new InputController({ role: this.role, playerId: this.playerId, sendCommand: sendGeneric, physics: this.role === 'host' ? this.physics : null, effects: this.renderer.effects });
    this.inputController.attach();
  }

  /**
   * Start the countdown sequence (3, 2, 1, FIGHT)
   */
  private startCountdown(): void {
    if (this.countdownActive) return;
    
    this.countdownActive = true;
    this.countdownValue = 3;
    
    // Clear any existing timeout
    if (this.countdownTimeoutId !== null) {
      window.clearTimeout(this.countdownTimeoutId);
    }
    
    // Pause physics so inputs don't affect the world until game starts
    if (this.role === 'host' && this.physics) {
      this.physics.stop();
    }
    
    // First tick: show 3, then after 1 second show 2
    this.countdownTimeoutId = window.setTimeout(() => {
      this.countdownValue = 2;
      // Second tick: show 2, then after 1 second show 1
      this.countdownTimeoutId = window.setTimeout(() => {
        this.countdownValue = 1;
        // Third tick: show 1, then after 1 second show FIGHT
        this.countdownTimeoutId = window.setTimeout(() => {
          this.countdownValue = 'FIGHT';
          // Fourth tick: show FIGHT, then after 1 second enable inputs
          this.countdownTimeoutId = window.setTimeout(() => {
            // Countdown complete - resume physics and enable inputs
            this.countdownActive = false;
            this.countdownValue = null;
            this.bothPlayersReady = true;
            
            // Resume physics to let inputs take effect
            if (this.role === 'host' && this.physics) {
              this.physics.start();
            }
            
            // Enable map shrinking on host
            if (this.role === 'host' && this.physics) {
              this.physics.enableMapShrinking();
            }
            
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
   * Capture effect events from the host's EffectManager
   */
  private setupEffectCapture(): void {
    if (this.role !== 'host') return;
    
    const originalImpact = this.renderer.effects.spawnImpactParticles.bind(this.renderer.effects);
    this.renderer.effects.spawnImpactParticles = (x, y, damage, vx, vy) => {
      originalImpact(x, y, damage, vx, vy);
      this.effectEvents.push({ type: 'impact', x, y, damage, vx, vy });
    };
    
    const originalDamage = this.renderer.effects.spawnDamageNumber.bind(this.renderer.effects);
    this.renderer.effects.spawnDamageNumber = (x, y, damage) => {
      originalDamage(x, y, damage);
      this.effectEvents.push({ type: 'damage', x, y, damage });
    };
    
    const originalTint = this.renderer.effects.applyBlockTint.bind(this.renderer.effects);
    this.renderer.effects.applyBlockTint = (bodyId, damage) => {
      originalTint(bodyId, damage);
      this.effectEvents.push({ type: 'tint', x: 0, y: 0, bodyId, damage });
    };

    // Capture explosions
    const originalExplosion = this.renderer.effects.spawnExplosionFlash.bind(this.renderer.effects);
    this.renderer.effects.spawnExplosionFlash = (x: number, y: number, radius: number, durationMs?: number) => {
      originalExplosion(x, y, radius, durationMs);
      this.effectEvents.push({ type: 'explosion', x, y, radius });
    };
  }

  /**
   * Handle incoming commands (host only)
   */
  private handleCommand(command: GameCommand): void {
    if (this.role !== 'host' || !this.physics) return;

    switch (command.type) {
      case 'player-init':
        // Legacy - spawn client's contraption if provided
        if (command.playerId !== this.playerId && command.contraption) {
          const x = WORLD_BOUNDS.WIDTH * 0.85;
          const y = 300;
          this.spawnContraption(x, y, command.playerId, command.contraption);
        }
        break;
      case 'player-ready':
        {
          const c = command as PlayerReadyCommand;
          // Mark player as ready
          this.readyStates.set(c.playerId, true);
          
          // Spawn vehicle for this player
          if (c.contraption) {
            const x = c.playerId === this.playerId ? WORLD_BOUNDS.WIDTH * 0.15 : WORLD_BOUNDS.WIDTH * 0.85;
            const y = 200;
            this.spawnContraption(x, y, c.playerId, c.contraption);
          }
          
          // Check if both players are ready
          const allReady = Array.from(this.readyStates.values()).every(v => v === true) && this.readyStates.size >= 2;
          if (allReady && !this.countdownActive) {
            // Start countdown (host will send event to client)
            this.startCountdown();
            // Host also sends event to client
            this.network.sendEvent({ type: 'countdown-start' });
          }
        }
        break;
      case 'block-input':
        {
          const c = command as BlockInputCommand;
          // Block-inputs always flow to pending inputs (physics is paused during countdown anyway)
          const binding = InputRegistry.getById(c.bindingId);
          const now = Date.now();
          const oneWay = this.network.getEstimatedOneWayMs ? (this.network.getEstimatedOneWayMs() || 0) : 0;
          const baseDelay = c.phase === 'press' ? (binding?.pressDelayMs || 0) : 0;
          const activateAt = Math.max(now, now + baseDelay - oneWay);
          const list = this.pendingInputs.get(c.bindingId) || [];
          list.push({ playerId: c.playerId, bindingId: c.bindingId, phase: c.phase, activateAt, payload: c.payload });
          this.pendingInputs.set(c.bindingId, list);
        }
        break;
      case 'spawn-box':
        this.spawnContraption(command.position.x, command.position.y, command.playerId, command.contraption);
        break;
    }
  }

  /**
   * Spawn a contraption in the physics world (host only)
   */
  private spawnContraption(x: number, y: number, playerId: string, contraptionData: ContraptionData): void {
    // No resources

    // Determine direction: host faces right (1), client faces left (-1)
    const direction = playerId === this.playerId ? 1 : -1;
    
    // Determine team: each player gets their own team
    const team = playerId;
    
    // Enforce 15% placement zone on each side
    const mapWidth = WORLD_BOUNDS.WIDTH;
    const zone = mapWidth * 0.15;
    const clampedX = playerId === this.playerId
      ? Math.max(0, Math.min(zone, x))
      : Math.max(mapWidth - zone, Math.min(mapWidth, x));

    // No build cooldown/resource animation; spawn immediately
    const durationMs = 0;

    // No resource calculation

    // Trigger building dust effect (for host and sync to client)
    // No build effects

    // Delay spawning until animation finishes
    setTimeout(() => {
      // Create contraption instance
      const contraption = new Contraption(
        `${contraptionData.id}-${Date.now()}`,
        contraptionData.name,
        direction,
        team,
        false,
        contraptionData.vehicleClass
      );
      
      // Load blocks
      contraptionData.blocks.forEach(blockData => {
        const block = blockFromData(blockData as BlockData);
        contraption.addBlock(block);
      });
      
      // Only register with physics engine on host
      if (this.physics) {
        this.physics.registerContraption(contraption);
      }
      
      // Calculate correct spawn Y based on vehicleClass
      const spawnPos = getTestSpawnPosition(undefined, contraptionData.vehicleClass);
      const spawnY = spawnPos.y;
      
      // Build physics (host only)
      const { bodies, constraints } = contraption.buildPhysics(clampedX, spawnY);
      
      // Only add to physics world on host
      if (this.physics) {
        bodies.forEach(body => {
          (body as ExtendedBody).ownerId = playerId;
          this.physics!.addBody(body);
        });
        constraints.forEach(constraint => this.physics!.addConstraint(constraint));
      }
      
    }, durationMs);
  }

  /**
   * Handle state update from host (client only) - Physics Channel
   */
  private handleStateUpdate(state: GameState): void {
    if (this.role === 'host') return;
    // Treat incoming state as a network snapshot
    const snapshot = { ...(state as unknown as NetworkSnapshot), _receivedAt: Date.now() } as NetworkSnapshot;
    
    // Cache metadata (sent once per body)
    snapshot.bodies.forEach(body => {
      if (body.ownerId && !this.ownerCache.has(body.id)) this.ownerCache.set(body.id, body.ownerId);
      if (body.label && !this.labelCache.has(body.id)) this.labelCache.set(body.id, body.label);
      if (body.spriteId && !this.spriteIdCache.has(body.id)) this.spriteIdCache.set(body.id, body.spriteId);
      if (body.spriteOffsetX !== undefined && !this.spriteOffsetXCache.has(body.id)) this.spriteOffsetXCache.set(body.id, body.spriteOffsetX);
      if (body.spriteOffsetY !== undefined && !this.spriteOffsetYCache.has(body.id)) this.spriteOffsetYCache.set(body.id, body.spriteOffsetY);
      if (body.spriteFlipX !== undefined && !this.spriteFlipXCache.has(body.id)) this.spriteFlipXCache.set(body.id, body.spriteFlipX);
      if (body.spriteFlipY !== undefined && !this.spriteFlipYCache.has(body.id)) this.spriteFlipYCache.set(body.id, body.spriteFlipY);
      if (body.spriteWidth !== undefined && !this.spriteWidthCache.has(body.id)) this.spriteWidthCache.set(body.id, body.spriteWidth);
      if (body.spriteHeight !== undefined && !this.spriteHeightCache.has(body.id)) this.spriteHeightCache.set(body.id, body.spriteHeight);
      if (body.groundColor && !this.groundColorCache.has(body.id)) this.groundColorCache.set(body.id, body.groundColor);
      if (body.width !== undefined && body.height !== undefined && !this.bodySizeCache.has(body.id)) {
        this.bodySizeCache.set(body.id, { width: body.width, height: body.height });
      }
    });
    
    // Just store the latest snapshot
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
            this.renderer.effects.spawnExplosionFlash(effect.x, effect.y, effect.radius || 40, 200);
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

  /**
   * Handle UI update from host (client only) - UI Channel
   */
  private handleUIUpdate(_uiState: UIState): void {
    if (this.role === 'host') return;
    // No resources/cooldowns
  }

  /**
   * Handle game event from host (client only) - Events Channel
   */
  private handleEvent(event: GameEvent): void {
    if (this.role === 'host') {
      // Host doesn't receive events from itself
      return;
    }

    switch (event.type) {
      case 'player-joined':
        break;
      case 'countdown-start':
        // Client receives countdown-start event from host
        this.startCountdown();
        break;
      case 'game-over':
        // Client receives game-over event from host
        this.winState = { winner: event.winner, loser: event.loser };
        break;
    }
  }

  /**
   * Serialize physics state for network transmission (host only)
   */
  private serializeState(): NetworkSnapshot | null {
    if (!this.physics) return null;

    const allBodies = this.physics.getAllBodies();
    
    const snapshot: NetworkSnapshot = {
      timestamp: Date.now(),
      bodies: allBodies.map(body => {
        const id = (body as ExtendedBody).customId || `static-${body.id}`;
        const isNew = !this.sentBodies.has(id);
        
        if (isNew) {
          this.sentBodies.add(id);
        }
        
        const block = (body as unknown as { block?: BaseBlock }).block;
        const isGround = body.isStatic && body.label === 'ground';
        
        // Determine spriteId and extract sprite metadata for contraption bodies
        let spriteId: string | undefined;
        let spriteOffsetX: number | undefined;
        let spriteOffsetY: number | undefined;
        let spriteFlipX: boolean | undefined;
        let spriteFlipY: boolean | undefined;
        let spriteWidth: number | undefined;
        let spriteHeight: number | undefined;
        
        if (!isGround) {
          const existingSprite = (body as unknown as { sprite?: { sheet: string; row: number; col?: number; offsetX?: number; offsetY?: number; flipX?: boolean; flipY?: boolean; width?: number; height?: number } }).sprite;
          if (existingSprite) {
            spriteId = `${existingSprite.sheet}:${existingSprite.row}${existingSprite.col !== undefined ? `:${existingSprite.col}` : ''}`;
            spriteOffsetX = existingSprite.offsetX;
            spriteOffsetY = existingSprite.offsetY;
            spriteFlipX = existingSprite.flipX;
            spriteFlipY = existingSprite.flipY;
            spriteWidth = existingSprite.width;
            spriteHeight = existingSprite.height;
          } else if (block) {
            const sheet = block.getSpritesheetName();
            const row = block.getSpriteRow();
            const col = (body as unknown as { spriteCol?: number }).spriteCol || 0;
            if (sheet) {
              spriteId = `${sheet}:${row}${col !== 0 ? `:${col}` : ''}`;
              const offset = block.getSpriteOffset();
              spriteOffsetX = offset.x;
              spriteOffsetY = offset.y;
              const size = block.getSpriteSize();
              spriteWidth = size.width;
              spriteHeight = size.height;
              // Note: flipX/flipY would need to be determined from contraption direction
              // For now, we'll extract it from the body's sprite if it exists
            }
          }
        }
        
        return {
          id,
          position: { x: body.position.x, y: body.position.y },
          angle: body.angle,
          circleRadius: body.circleRadius,
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
          groundColor: isGround && isNew ? ((body.render as Matter.IBodyRenderOptions)?.fillStyle || '#555555') : undefined,
          width: isNew && body.isStatic ? body.circleRadius ? undefined : (body.bounds?.max.x ?? 0) - (body.bounds?.min.x ?? 0) : undefined,
          height: isNew && body.isStatic ? body.circleRadius ? undefined : (body.bounds?.max.y ?? 0) - (body.bounds?.min.y ?? 0) : undefined,
          velocity: { x: (body as unknown as { velocity?: { x: number; y: number } }).velocity?.x || 0, y: (body as unknown as { velocity?: { x: number; y: number } }).velocity?.y || 0 },
          angularVelocity: (body as unknown as { angularVelocity?: number }).angularVelocity || 0,
        };
      }),
      effects: this.effectEvents.length > 0 ? [...this.effectEvents] : undefined,
    };
    
    // Clear effect events after sending
    this.effectEvents = [];
    
    // Clean up tracking for removed bodies
    const currentBodyIds = new Set(snapshot.bodies.map(b => b.id));
    this.sentBodies.forEach(id => {
      if (!currentBodyIds.has(id)) {
        this.sentBodies.delete(id);
      }
    });
    
    return snapshot;
  }

  /**
   * Serialize UI state for network transmission (host only)
   */
  private serializeUIState(): UIState { return { resources: {}, cooldowns: {} }; }

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
   * Main game loop
   */
  private gameLoop = (): void => {
    if (!this.isRunning) return;

    const now = Date.now();

    // Host: apply any due delayed generic inputs
    if (this.role === 'host' && this.physics && this.pendingInputs.size > 0) {
      const toClear: string[] = [];
      this.pendingInputs.forEach((list, bindingId) => {
        const binding = InputRegistry.getById(bindingId);
        if (!binding) { toClear.push(bindingId); return; }
        const remain: typeof list = [];
        for (const item of list) {
          if (item.activateAt <= now) {
            binding.apply({ role: this.role, playerId: item.playerId, physics: this.physics }, item.phase, item.payload);
          } else {
            remain.push(item);
          }
        }
        if (remain.length > 0) this.pendingInputs.set(bindingId, remain); else toClear.push(bindingId);
      });
      if (toClear.length) toClear.forEach(id => this.pendingInputs.delete(id));
    }

    // No periodic resource updates

    // Host: sync physics state to client periodically (20Hz)
    if (this.role === 'host' && this.network.isConnected()) {
      const oneWay = this.network.getEstimatedOneWayMs ? (this.network.getEstimatedOneWayMs() || 0) : 0;
      if (oneWay > 200) {
        // High latency: drop to 5Hz (200ms interval)
        this.syncInterval = 200;
      } else if (oneWay > 75) {
        // Moderate latency: drop to 10Hz (100ms interval)
        this.syncInterval = 100;
      } else {
        // Low latency: keep at 20Hz (50ms interval)
        this.syncInterval = 50;
      }
      

      if (now - this.lastSyncTime >= this.syncInterval) {
        const state = this.serializeState();
        if (state) {
          this.network.sendState(state as unknown);
          this.lastSyncTime = now;
        }
      }
    }

    // Host: sync UI state to client periodically (10Hz)
    if (this.role === 'host' && this.network.isConnected()) {
      if (now - this.lastUISyncTime >= this.uiSyncInterval) {
        const uiState = this.serializeUIState();
        this.network.sendUIUpdate(uiState);
        this.lastUISyncTime = now;
      }
    }

    // Render
    if (this.role === 'host' && this.physics) {
      // Host renders from physics engine
      this.renderer.renderPhysics(this.physics.getAllBodies());
    } else {
      // Client: render latest snapshot directly (no interpolation)
      const bodies = this.getLatestSnapshotBodies();
      this.renderer.renderPhysics(bodies as Matter.Body[]);
    }

    // Render countdown overlay
    this.renderCountdown();

    // Check and render win condition
    if (this.bothPlayersReady && !this.winState) {
      this.checkWinCondition();
    }
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
    
    // Save context (countdown is rendered in screen space, not world space)
    ctx.save();
    
    // Reset camera transform for screen-space rendering
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    
    // Set up text styling
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fontSize = Math.min(width, height) * 0.15;
    ctx.font = `bold ${fontSize}px Arial`;
    
    // Add text shadow for better visibility
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    // Draw countdown text
    if (typeof this.countdownValue === 'number') {
      ctx.fillStyle = '#ffffff';
      ctx.fillText(this.countdownValue.toString(), width / 2, height / 2);
    } else if (this.countdownValue === 'FIGHT') {
      ctx.fillStyle = '#ff0000';
      const fightFontSize = Math.min(width, height) * 0.12;
      ctx.font = `bold ${fightFontSize}px Arial`;
      ctx.fillText('FIGHT!', width / 2, height / 2);
    }
    
    // Restore context
    ctx.restore();
  }

  /**
   * Check if a player's contraption is dead and update win state
   */
  private checkWinCondition(): void {
    if (this.winState) return; // Game already over
    if (!this.bothPlayersConnected) return; // Not ready yet
    
    // Get all player IDs
    const players = Array.from(this.readyStates.keys());
    if (players.length < 2) return;
    
    const [player1, player2] = players;
    const bodies = this.physics?.getAllBodies() || [];
    
    // Count core blocks per player
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
    
    // Check if one player has no cores left
    const player1HasCore = coresPerPlayer.get(player1) || 0 > 0;
    const player2HasCore = coresPerPlayer.get(player2) || 0 > 0;
    
    if (!player1HasCore && player2HasCore) {
      this.winState = { winner: player2, loser: player1 };
      this.network.sendEvent({ type: 'game-over', winner: player2, loser: player1 });
    } else if (player1HasCore && !player2HasCore) {
      this.winState = { winner: player1, loser: player2 };
      this.network.sendEvent({ type: 'game-over', winner: player1, loser: player2 });
    }
  }

  /**
   * Render win/loss overlay
   */
  private renderWinScreen(): void {
    if (!this.winState) return;
    
    const ctx = this.renderer.getContext();
    const width = this.canvas.width;
    const height = this.canvas.height;
    
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    
    // Semi-transparent overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, width, height);
    
    // Win/Loss text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fontSize = Math.min(width, height) * 0.1;
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    if (this.winState.winner === this.playerId) {
      ctx.fillStyle = '#00ff00';
      ctx.fillText('YOU WIN!', width / 2, height / 2);
    } else {
      ctx.fillStyle = '#ff0000';
      ctx.fillText('YOU LOST!', width / 2, height / 2);
    }
    
    ctx.restore();
  }

  /**
   * Get latest snapshot bodies without interpolation
   */
  private getLatestSnapshotBodies(): Matter.Body[] {
    if (!this.latestSnapshot) {
      return Array.from(this.bodies.values());
    }

    const snapshot = this.latestSnapshot;
    const result: Matter.Body[] = [];
    
    // Simple string -> number hash for deterministic id used by crack rendering
    const hashId = (s: string): number => {
      let h = 0;
      for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h) + s.charCodeAt(i);
        h |= 0;
      }
      return Math.abs(h) + 1; // ensure > 0
    };

    snapshot.bodies.forEach(body => {
      // For ground blocks, we need to create a simple rectangle shape
      // For contraption bodies, we'll reconstruct basic shape from spriteId or default to rectangle
      const isGround = body.isStatic && body.label === 'ground';
      
      // Get dimensions from snapshot or cache
      const size = this.bodySizeCache.get(body.id);
      const width = body.width ?? size?.width ?? (isGround ? BUILDER_CONSTANTS.GROUND_BLOCK_SIZE : BUILDER_CONSTANTS.BLOCK_SIZE);
      const height = body.height ?? size?.height ?? (isGround ? BUILDER_CONSTANTS.GROUND_BLOCK_SIZE : BUILDER_CONSTANTS.BLOCK_SIZE);
      
      const halfWidth = width / 2;
      const halfHeight = height / 2;
      
      const vertices = [
        { x: body.position.x - halfWidth, y: body.position.y - halfHeight },
        { x: body.position.x + halfWidth, y: body.position.y - halfHeight },
        { x: body.position.x + halfWidth, y: body.position.y + halfHeight },
        { x: body.position.x - halfWidth, y: body.position.y + halfHeight },
      ];

      const fakeBody: Partial<Matter.Body> & { id: number } = {
        id: hashId(body.id),
        position: body.position,
        angle: body.angle,
        vertices,
        circleRadius: body.circleRadius,
        isStatic: body.isStatic,
        render: {
          ...body.render,
          fillStyle: isGround ? (body.groundColor || this.groundColorCache.get(body.id) || body.render.fillStyle) : body.render.fillStyle,
        },
      };
      (fakeBody as unknown as { ownerId?: string }).ownerId = body.ownerId || this.ownerCache.get(body.id);
      (fakeBody as unknown as { label?: string }).label = body.label || this.labelCache.get(body.id);
      
      // Parse spriteId and reconstruct sprite object with all metadata
      const spriteId = body.spriteId || this.spriteIdCache.get(body.id);
      if (spriteId) {
        const parts = spriteId.split(':');
        if (parts.length >= 2) {
          const sheet = parts[0];
          const row = parseInt(parts[1], 10);
          const col = parts[2] ? parseInt(parts[2], 10) : 0;
          
          // Get sprite metadata from snapshot or cache
          const offsetX = body.spriteOffsetX !== undefined ? body.spriteOffsetX : (this.spriteOffsetXCache.get(body.id) ?? 0);
          const offsetY = body.spriteOffsetY !== undefined ? body.spriteOffsetY : (this.spriteOffsetYCache.get(body.id) ?? 0);
          const flipX = body.spriteFlipX !== undefined ? body.spriteFlipX : (this.spriteFlipXCache.get(body.id) ?? false);
          const flipY = body.spriteFlipY !== undefined ? body.spriteFlipY : (this.spriteFlipYCache.get(body.id) ?? false);
          const spriteWidth = body.spriteWidth !== undefined ? body.spriteWidth : (this.spriteWidthCache.get(body.id));
          const spriteHeight = body.spriteHeight !== undefined ? body.spriteHeight : (this.spriteHeightCache.get(body.id));
          
          const sprite: { sheet: string; row: number; offsetX: number; offsetY: number; col?: number; flipX?: boolean; flipY?: boolean; width?: number; height?: number } = {
            sheet,
            row,
            offsetX,
            offsetY,
            col,
          };
          
          if (flipX) sprite.flipX = flipX;
          if (flipY) sprite.flipY = flipY;
          if (spriteWidth !== undefined) sprite.width = spriteWidth;
          if (spriteHeight !== undefined) sprite.height = spriteHeight;
          
          (fakeBody as unknown as { sprite?: typeof sprite }).sprite = sprite;
        }
      }
      
      result.push(fakeBody as Matter.Body);
    });

    return result;
  }

  /**
   * Get the current win state
   */
  getWinState(): { winner: string; loser: string } | null {
    return this.winState;
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
    // Clear countdown timeout
    if (this.countdownTimeoutId !== null) {
      window.clearTimeout(this.countdownTimeoutId);
      this.countdownTimeoutId = null;
    }
    this.physics?.destroy();
    this.renderer.destroy();
    this.network.disconnect();
  }

  setSelectedContraption(data: ContraptionSaveData | null): void {
    if (data) this.savedContraption = data;
  }

  sendReadyCommand(cmd: PlayerReadyCommand): void {
    if (this.role === 'host') {
      // Host handles its own ready state directly
      this.handleCommand(cmd as unknown as GameCommand);
    } else {
      // Client sends ready command to host
      this.network.sendCommand(cmd as unknown as GameCommand);
    }
  }

  getPlayerResources(_playerId: string): { energy: number } | null { return null; }
  getMyEnergy(): number { return 0; }

  getBaseHealth(): { mine: number; enemy: number } {
    return {
      mine: 10,
      enemy: 10,
    };
  }

}

