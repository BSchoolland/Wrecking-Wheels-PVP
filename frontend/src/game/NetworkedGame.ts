/**
 * Networked Game - Handles both host and client modes
 */

import { PhysicsEngine } from '@/core/physics/PhysicsEngine';
import { Renderer } from '@/rendering/Renderer';
import { NetworkManager, NetworkRole } from '@/core/networking/NetworkManager';
import type { GameCommand, ContraptionData, UIState, GameEvent, WheelInputCommand, PlayerInitCommand } from '@shared/types/Commands';
import type { GameState } from '@shared/types/GameState';
import type * as Matter from 'matter-js';
import { Contraption, blockFromData } from '@/game/contraptions';
import type { ContraptionSaveData } from '@/game/contraptions/Contraption';
import type { BlockData } from '@/game/contraptions/blocks/BaseBlock';
import { WheelBlock } from '@/game/contraptions/blocks/WheelBlock';
import { WORLD_BOUNDS } from '@shared/constants/physics';

// Extended Matter.js types for our use case
interface ExtendedBody extends Matter.Body {
  customId?: string;
  ownerId?: string;
}

interface SerializableBody {
  id: string;
  position: { x: number; y: number };
  angle: number;
  vertices?: Array<{ x: number; y: number }>;
  circleRadius?: number;
  isStatic: boolean;
  render: {
    fillStyle: string;
    healthPercent?: number;
  };
  ownerId?: string;
  label?: string;
  // Optional kinematics for better interpolation
  // velocity?: { x: number; y: number };
  // angularVelocity?: number;
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
  baseHostHp?: number;
  baseClientHp?: number;
}

interface NetworkedGameConfig {
  canvas: HTMLCanvasElement;
  role: NetworkRole;
  lobbyId: string;
  playerId: string;
  contraption: ContraptionSaveData;
  onContraptionSpawned?: () => void;
  onGameOver?: (winner: 'host' | 'client') => void;
}

export class NetworkedGame {
  private canvas: HTMLCanvasElement;
  private role: NetworkRole;
  private playerId: string;
  
  private physics: PhysicsEngine | null = null;
  private renderer: Renderer;
  private network: NetworkManager;
  private onContraptionSpawned?: () => void;
  private savedContraption: ContraptionSaveData | null = null;
  
  private isRunning = false;
  private animationFrameId: number | null = null;
  
  // Track bodies for state sync
  private bodies: Map<string, ExtendedBody> = new Map();
  private lastSyncTime = 0;
  private syncInterval = 50; // Send physics updates every 50ms (20 times per second)
  private lastUISyncTime = 0;
  private uiSyncInterval = 100; // Send UI updates every 100ms (10 times per second)
  
  // Effect events to sync (host only)
  private effectEvents: EffectEvent[] = [];
  
  // Client-side: cache vertices for bodies (since they don't change)
  private verticesCache: Map<string, Array<{ x: number; y: number }>> = new Map();
  // Client-side: cache owner/label metadata (sent once per body)
  private ownerCache: Map<string, string> = new Map();
  private labelCache: Map<string, string> = new Map();
  
  // Host-side: track which bodies we've sent full data for
  private sentBodies: Set<string> = new Set();

  // Client-side interpolation buffer
  private snapshotBuffer: NetworkSnapshot[] = [];
  private interpolationDelay = 100; // ms to buffer behind for smoothness
  private interpolationEnabled = true; // toggle for interpolation
  
  private latestSnapshot: NetworkSnapshot | null = null;
  private gameEnded = false;
  private onGameOver?: (winner: 'host' | 'client') => void;

  // Track estimated host time offset (hostNow ≈ clientNow + hostTimeOffsetMs)
  private hostTimeOffsetMs = 0;

  // Cooldowns per player (disabled)
  private buildCooldowns: Map<string, number> = new Map();
  
  // Track when both players are connected
  private bothPlayersConnected = false;
  
  public energy: number = 0;

  // Host-side: schedule wheel input changes with a fixed delay for fairness
  private pendingWheelInputs: Map<string, { value: number; activateAt: number }> = new Map();

  constructor(config: NetworkedGameConfig) {
    this.canvas = config.canvas;
    this.role = config.role;
    this.playerId = config.playerId;
    this.savedContraption = config.contraption;
    this.onContraptionSpawned = config.onContraptionSpawned;
    this.onGameOver = config.onGameOver;
    
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
    
    // Initialize physics (host only)
    if (this.role === 'host') {
      this.physics = new PhysicsEngine();
      this.physics.setEffectManager(this.renderer.effects);
      this.setupEffectCapture();
      this.physics.start();
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
        if (import.meta.env.DEV) console.log('Peer connected!');
        this.bothPlayersConnected = true;
        if (import.meta.env.DEV) console.log('Both players connected - energy generation started');
        // Host spawns own contraption immediately; client informs host of theirs
        if (this.role === 'host') {
          if (this.savedContraption) {
            const x = WORLD_BOUNDS.WIDTH * 0.15;
            const y = 200;
            this.spawnContraption(x, y, this.playerId, this.savedContraption);
          }
        } else {
          const initCmd: PlayerInitCommand = { type: 'player-init', playerId: this.playerId, contraption: this.savedContraption || undefined };
          this.network.sendCommand(initCmd as unknown as GameCommand);
        }
      },
      onDisconnected: () => { 
        if (import.meta.env.DEV) console.log('Peer disconnected!');
        this.bothPlayersConnected = false;
      },
    });

    // Disable click spawn
    this.setupClickHandler();

    // Minimal A/D input: host applies locally; client sends command
    let currentInput = 0;
    const sendInput = (v: number) => {
      if (v === currentInput) return;
      currentInput = v;
      if (this.role === 'host') {
        this.pendingWheelInputs.set(this.playerId, { value: v, activateAt: Date.now() + WheelBlock.INPUT_DELAY_MS });
      } else {
        const cmd: WheelInputCommand = { type: 'wheel-input', playerId: this.playerId, value: v };
        this.network.sendCommand(cmd as unknown as GameCommand);
      }
    };
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.key === 'a' || e.key === 'A') sendInput(1);
      if (e.key === 'd' || e.key === 'D') sendInput(-1);
      if ((e.key === 'a' || e.key === 'A' || e.key === 'd' || e.key === 'D') && currentInput !== 0) {
        this.renderer.effects.startWheelGlow(this.playerId);
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'a' || e.key === 'A') sendInput(0);
      if (e.key === 'd' || e.key === 'D') sendInput(0);
      if (e.key === 'a' || e.key === 'A' || e.key === 'd' || e.key === 'D') {
        this.renderer.effects.stopWheelGlow(this.playerId);
      }
    });
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
   * Set up click handler to spawn contraptions
   */
  private setupClickHandler(): void {
    this.canvas.addEventListener('click', (_e) => {
      // disabled
    });
  }

  /**
   * Handle incoming commands (host only)
   */
  private handleCommand(command: GameCommand): void {
    if (this.role !== 'host' || !this.physics) return;

    if (this.physics.isGameOver()) return;

    switch (command.type) {
      case 'player-init':
        // Spawn client's contraption if provided
        if (command.playerId !== this.playerId && command.contraption) {
          const x = WORLD_BOUNDS.WIDTH * 0.85;
          const y = 300;
          this.spawnContraption(x, y, command.playerId, command.contraption);
        }
        break;
      case 'wheel-input':
        {
          const now = Date.now();
          const oneWay = this.network.getEstimatedOneWayMs ? (this.network.getEstimatedOneWayMs() || 0) : 0;
          const interp = this.interpolationDelay;
          const activateAt = Math.max(now, now + WheelBlock.INPUT_DELAY_MS - oneWay - interp);
          this.pendingWheelInputs.set((command as WheelInputCommand).playerId, {
            value: (command as WheelInputCommand).value,
            activateAt,
          });
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
    if (!this.physics) return;

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
      if (!this.physics) return;

      // Create contraption instance
      const contraption = new Contraption(
        `${contraptionData.id}-${Date.now()}`,
        contraptionData.name,
        direction,
        team
      );
      
      // Load blocks
      contraptionData.blocks.forEach(blockData => {
        const block = blockFromData(blockData as BlockData);
        contraption.addBlock(block);
      });
      
      // Register with physics engine
      this.physics.registerContraption(contraption);
      
      // Build physics
      const { bodies, constraints } = contraption.buildPhysics(clampedX, y);
      
      // Add to physics world
      bodies.forEach(body => {
        (body as ExtendedBody).ownerId = playerId;
        this.physics!.addBody(body);
      });
      constraints.forEach(constraint => this.physics!.addConstraint(constraint));
      
      if (import.meta.env.DEV) console.log('Spawned contraption at', clampedX, y, 'for player', playerId, 'direction', direction);
    }, durationMs);
  }

  /**
   * Handle state update from host (client only) - Physics Channel
   */
  private handleStateUpdate(state: GameState): void {
    if (this.role === 'host') return;
    // Treat incoming state as a network snapshot for interpolation
    const snapshot = { ...(state as unknown as NetworkSnapshot), _receivedAt: Date.now() } as NetworkSnapshot;

    // Update host time offset estimate (EMA) so client can convert to host time
    const recvNow = snapshot._receivedAt || Date.now();
    const oneWay = this.network.getEstimatedOneWayMs ? (this.network.getEstimatedOneWayMs() || 0) : 0;
    const estimatedHostNowAtReceive = snapshot.timestamp + oneWay;
    const offsetEstimate = estimatedHostNowAtReceive - recvNow;
    this.hostTimeOffsetMs = this.hostTimeOffsetMs === 0
      ? offsetEstimate
      : this.hostTimeOffsetMs + (offsetEstimate - this.hostTimeOffsetMs) * 0.1;
    
    // Cache vertices in LOCAL coordinates (relative to body center, unrotated)
    snapshot.bodies.forEach(body => {
      if (body.vertices && body.vertices.length > 0 && !this.verticesCache.has(body.id)) {
        // Convert world vertices to local coordinates
        const localVertices = body.vertices.map(v => {
          const dx = v.x - body.position.x;
          const dy = v.y - body.position.y;
          // Rotate back by -angle to get unrotated local coords
          const cos = Math.cos(-body.angle);
          const sin = Math.sin(-body.angle);
          return {
            x: dx * cos - dy * sin,
            y: dx * sin + dy * cos
          };
        });
        this.verticesCache.set(body.id, localVertices);
      }
      if (body.ownerId && !this.ownerCache.has(body.id)) this.ownerCache.set(body.id, body.ownerId);
      if (body.label && !this.labelCache.has(body.id)) this.labelCache.set(body.id, body.label);
    });
    
    this.snapshotBuffer.push(snapshot);
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

    // Keep only the last ~1s of snapshots + interpolation delay (by host time), but never drain to zero
    const hostNow = Date.now() + this.hostTimeOffsetMs;
    const cutoff = hostNow - 1000 - this.interpolationDelay;
    while (
      this.snapshotBuffer.length > 1 &&
      (this.snapshotBuffer[0].timestamp as number) < cutoff
    ) {
      this.snapshotBuffer.shift();
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
    if (this.role === 'host') return;

    switch (event.type) {
      case 'game-over':
        if (!this.gameEnded) {
          this.gameEnded = true;
          if (this.onGameOver) {
            this.onGameOver(event.winner);
          }
        }
        break;
      case 'player-joined':
        if (import.meta.env.DEV) console.log('Player joined:', event.playerId);
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
        
        // Send vertices only for new bodies
        if (isNew) {
          this.sentBodies.add(id);
        }
        
        return {
          id,
          position: { x: body.position.x, y: body.position.y },
          angle: body.angle,
          vertices: isNew ? body.vertices.map((v: Matter.Vector) => ({ x: v.x, y: v.y })) : undefined,
          circleRadius: body.circleRadius,
          isStatic: body.isStatic,
          render: {
            fillStyle: (body.render as Matter.IBodyRenderOptions)?.fillStyle || (body.isStatic ? '#555555' : '#3498db'),
            healthPercent: (() => {
              const block = (body as unknown as { block?: { health: number; maxHealth: number } }).block;
              if (block && block.maxHealth > 0) {
                return Math.max(0, Math.min(1, block.health / block.maxHealth));
              }
              if (body.label === 'base-host') {
                return this.physics!.getBaseHp('host') / 10;
              }
              if (body.label === 'base-client') {
                return this.physics!.getBaseHp('client') / 10;
              }
              return undefined;
            })(),
          },
          ownerId: isNew ? ((body as ExtendedBody).ownerId || undefined) : undefined,
          label: isNew ? (body.label || undefined) : undefined,
          velocity: { x: (body as unknown as { velocity?: { x: number; y: number } }).velocity?.x || 0, y: (body as unknown as { velocity?: { x: number; y: number } }).velocity?.y || 0 },
          angularVelocity: (body as unknown as { angularVelocity?: number }).angularVelocity || 0,
        };
      }),
      effects: this.effectEvents.length > 0 ? [...this.effectEvents] : undefined,
      baseHostHp: this.physics!.getBaseHp('host'),
      baseClientHp: this.physics!.getBaseHp('client'),
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
   * Main game loop
   */
  private gameLoop = (): void => {
    if (!this.isRunning) return;

    const now = Date.now();

    // Host: apply any due delayed wheel inputs
    if (this.role === 'host' && this.physics && this.pendingWheelInputs.size > 0) {
      const toDelete: string[] = [];
      this.pendingWheelInputs.forEach((pending, playerId) => {
        if (pending.activateAt <= now) {
          this.physics!.setWheelInput(playerId, pending.value);
          toDelete.push(playerId);
        }
      });
      if (toDelete.length) toDelete.forEach(id => this.pendingWheelInputs.delete(id));
    }

    // No periodic resource updates

    // Detect game over on host
    if (this.role === 'host' && this.physics && !this.gameEnded && this.physics.isGameOver()) {
      this.gameEnded = true;
      const hostHp = this.physics.getBaseHp('host');
      const clientHp = this.physics.getBaseHp('client');
      let winner: 'host' | 'client' | null = null;
      if (clientHp <= 0) {
        winner = 'host';
      } else if (hostHp <= 0) {
        winner = 'client';
      }
      
      // Send game-over event via events channel
      if (winner) {
        this.network.sendEvent({ type: 'game-over', winner });
        if (this.onGameOver) {
          this.onGameOver(winner);
        }
      }
    }

    // Host: sync physics state to client periodically (20Hz)
    if (this.role === 'host' && this.network.isConnected()) {
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
        if (import.meta.env.DEV) console.log('Host sending UI update:', uiState);
        this.network.sendUIUpdate(uiState);
        this.lastUISyncTime = now;
      }
    }

    // Render
    if (this.role === 'host' && this.physics) {
      // Host renders from physics engine
      this.renderer.renderPhysics(this.physics.getAllBodies());
    } else {
      // Client: render interpolated snapshot or latest snapshot
      const hostNow = now + this.hostTimeOffsetMs;
      const renderTime = hostNow - this.interpolationDelay;
      const bodies = this.getInterpolatedBodies(renderTime);
      this.renderer.renderPhysics(bodies as Matter.Body[]);
    }

    this.animationFrameId = requestAnimationFrame(this.gameLoop);
  };

  /**
   * Build interpolated Matter-like bodies for rendering on the client
   */
  private getInterpolatedBodies(targetTime: number): Matter.Body[] {
    if (this.snapshotBuffer.length === 0) {
      return Array.from(this.bodies.values());
    }
  
    // Step 1: Find the two snapshots bracketing targetTime
    let prev = this.snapshotBuffer[0];
    let next = this.snapshotBuffer[this.snapshotBuffer.length - 1];
  
    for (let i = 0; i < this.snapshotBuffer.length - 1; i++) {
      const a = this.snapshotBuffer[i];
      const b = this.snapshotBuffer[i + 1];
      if (a.timestamp <= targetTime && targetTime <= b.timestamp) {
        prev = a;
        next = b;
        break;
      }
    }
  
    // Step 2: Calculate interpolation fraction
    const timeBetween = next.timestamp - prev.timestamp;
    const timeElapsed = targetTime - prev.timestamp;
    const fraction = timeBetween > 0 ? timeElapsed / timeBetween : 0;
    const clampedFraction = Math.max(0, Math.min(1, fraction));
  
    // Step 3: Create maps for easy lookup
    const prevMap = new Map(prev.bodies.map(b => [b.id, b]));
    const nextMap = new Map(next.bodies.map(b => [b.id, b]));
    
    // Get all body IDs from both snapshots
    const allIds = new Set([...prevMap.keys(), ...nextMap.keys()]);
  
    // Helper function from your original code
    const hashId = (s: string): number => {
      let h = 0;
      for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h) + s.charCodeAt(i);
        h |= 0;
      }
      return Math.abs(h) + 1;
    };
  
    const result: Matter.Body[] = [];
  
    allIds.forEach(id => {
      const prevBody = prevMap.get(id);
      const nextBody = nextMap.get(id);
  
      // Handle bodies that exist in both snapshots
      if (prevBody && nextBody) {
        // Interpolate position
        const interpolatedPosition = {
          x: prevBody.position.x + (nextBody.position.x - prevBody.position.x) * clampedFraction,
          y: prevBody.position.y + (nextBody.position.y - prevBody.position.y) * clampedFraction
        };
  
        // Interpolate angle (simple linear for now - we can improve this later)
        const interpolatedAngle = prevBody.angle + (nextBody.angle - prevBody.angle) * clampedFraction;
  
        // Get vertices from snapshots if available, otherwise from cache
        let vertices: Array<{ x: number; y: number }>;
        if (prevBody.vertices || nextBody.vertices) {
          vertices = prevBody.vertices || nextBody.vertices || [];
        } else {
          const localVerts = this.verticesCache.get(id) || [];
          const cos = Math.cos(interpolatedAngle);
          const sin = Math.sin(interpolatedAngle);
          vertices = localVerts.map(v => ({
            x: interpolatedPosition.x + (v.x * cos - v.y * sin),
            y: interpolatedPosition.y + (v.x * sin + v.y * cos)
          }));
        }
  
        // Create the fake body
        const fakeBody: Partial<Matter.Body> & { id: number } = {
          id: hashId(id),
          position: interpolatedPosition,
          angle: interpolatedAngle,
          vertices,
          circleRadius: prevBody.circleRadius ?? nextBody.circleRadius,
          isStatic: prevBody.isStatic ?? nextBody.isStatic,
          render: prevBody.render ?? nextBody.render ?? { fillStyle: '#3498db' },
        };
        
        // Add cached metadata
        (fakeBody as any).ownerId = this.ownerCache.get(id);
        (fakeBody as any).label = this.labelCache.get(id);
        
        result.push(fakeBody as Matter.Body);
      }
      
      // TODO: Handle bodies only in prev (being destroyed)
      else if (prevBody && !nextBody) {
        // Body is being destroyed - for now, just show it at prev position
        // You mentioned wanting to trigger destruction animation here
      }
      
      // TODO: Handle bodies only in next (newly created)
      else if (!prevBody && nextBody) {
        // Body just appeared - for now, just show it at next position
      }
    });
  
    return result;
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
    this.physics?.destroy();
    this.renderer.destroy();
    this.network.disconnect();
  }

  setSelectedContraption(data: ContraptionSaveData | null): void {
    if (data) this.savedContraption = data;
  }

  getPlayerResources(_playerId: string): { energy: number } | null { return null; }
  getMyEnergy(): number { return 0; }

  getBaseHealth(): { mine: number; enemy: number } {
    if (this.role === 'host' && this.physics) {
      return {
        mine: this.physics.getBaseHp('host'),
        enemy: this.physics.getBaseHp('client'),
      };
    } else {
      return {
        mine: this.latestSnapshot?.baseClientHp ?? 10,
        enemy: this.latestSnapshot?.baseHostHp ?? 10,
      };
    }
  }

  setInterpolationEnabled(enabled: boolean): void {
    this.interpolationEnabled = enabled;
  }
}

