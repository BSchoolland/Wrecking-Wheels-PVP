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
  contraption: ContraptionSaveData;
  onContraptionSpawned?: () => void;
  onGameOver?: (winner: 'host' | 'client' | 'tie') => void;
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

  // Client-side interpolation buffer
  private snapshotBuffer: NetworkSnapshot[] = [];
  private interpolationDelay = 300; // ms to buffer behind for smoothness (adaptive)

  private latestSnapshot: NetworkSnapshot | null = null;
  private gameEnded = false;
  private onGameOver?: (winner: 'host' | 'client' | 'tie') => void;

  // Packet rate tracking (client only)
  private packetsReceivedThisSecond = 0;
  private handleStateUpdateCallsThisSecond = 0;
  private lastPacketRateLog = 0;
  private recentPacketRate = 20; // Moving average of packet rate

  // Host-side: track when vertices were last sent for each body
  private lastVerticesSent: Map<string, number> = new Map();
  private readonly verticesResendInterval = 2000; // Resend vertices every 2000ms
  private readonly maxVerticesPerFrame = 5; // Limit vertices sent per frame to keep packets small

  // Cooldowns per player (unused, but kept for minimal impact if referenced in effects)
  private buildCooldowns: Map<string, number> = new Map();
  public energy: number = 0;

  constructor(config: NetworkedGameConfig) {
    this.canvas = config.canvas;
    this.role = config.role;
    this.playerId = config.playerId;
    this.savedContraption = config.contraption;
    this.onContraptionSpawned = config.onContraptionSpawned;
    this.onGameOver = config.onGameOver;
    
    this.energy = 0;
    
    // Initialize packet rate tracking
    this.lastPacketRateLog = Date.now();
    
    // Initialize renderer
    this.renderer = new Renderer(this.canvas);
    this.renderer.setPlayerRole(this.role);
    // Mirror view for clients so they perceive themselves on the right moving left
    if (this.role === 'client') {
      this.renderer.camera.mirrorX = true;
    }
    
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
        // Host spawns their contraption immediately; client informs host of selection
        if (this.role === 'host') {
          const x = WORLD_BOUNDS.WIDTH * 0.15;
          const y = 200;
          this.spawnContraption(x, y, this.playerId, this.savedContraption!);
        } else {
          const initCmd: PlayerInitCommand = { type: 'player-init', playerId: this.playerId, contraption: this.savedContraption! };
          this.network.sendCommand(initCmd);
        }
      },
      onDisconnected: () => { 
        if (import.meta.env.DEV) console.log('Peer disconnected!');
      },
    });
    
    // Set up input handlers
    this.setupInputHandlers();
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
  private setupClickHandler(): void {}

  /**
   * Handle incoming commands (host only)
   */
  private handleCommand(command: GameCommand): void {
    if (this.role !== 'host' || !this.physics) return;

    if (this.physics.isGameOver()) return;

    switch (command.type) {
      case 'player-init':
        // Spawn client's contraption on right side
        if (command.playerId !== this.playerId && command.contraption) {
          const x = WORLD_BOUNDS.WIDTH * 0.85;
          const y = 300;
          this.spawnContraption(x, y, command.playerId, command.contraption);
        }
        break;
      case 'wheel-input':
        this.physics.setWheelInput((command as WheelInputCommand).playerId, (command as WheelInputCommand).value);
        break;
    }
  }

  /**
   * Spawn a contraption in the physics world (host only)
   */
  private spawnContraption(x: number, y: number, playerId: string, contraptionData: ContraptionData): void {
    if (!this.physics) return;

    // Determine direction: host faces right (1), client faces left (-1)
    const direction = playerId === this.playerId ? 1 : -1;
    
    // Determine team: each player gets their own team
    const team = playerId;
    
    const clampedX = x;

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
    // Set bot flag so wheels auto-drive if no input
    this.physics.setBot(playerId, !!contraptionData.isBot);
    
    // Build physics
    const { bodies, constraints } = contraption.buildPhysics(clampedX, y);
    
    // Add to physics world
    bodies.forEach(body => {
      (body as ExtendedBody).ownerId = playerId;
      (body as unknown as { driveDir?: number }).driveDir = direction;
      this.physics!.addBody(body);
    });
    constraints.forEach(constraint => this.physics!.addConstraint(constraint));
    
    if (import.meta.env.DEV) console.log('Spawned contraption at', clampedX, y, 'for player', playerId, 'direction', direction);
  }

  /**
   * Handle state update from host (client only) - Physics Channel
   */
  private handleStateUpdate(state: GameState): void {
    if (this.role === 'host') return;
    
    // Track packet rate
    this.handleStateUpdateCallsThisSecond++;
    this.packetsReceivedThisSecond++;
    
    // Treat incoming state as a network snapshot for interpolation
    const snapshot = { ...(state as unknown as NetworkSnapshot), _receivedAt: Date.now() } as NetworkSnapshot;
    
    // Cache vertices in LOCAL coordinates (relative to body center, unrotated)
    snapshot.bodies.forEach(body => {
      const hasCache = this.verticesCache.has(body.id);
      if (body.vertices && body.vertices.length > 0 && !hasCache) {
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
      // If we have cached vertices, ignore incoming vertices updates
      if (this.verticesCache.has(body.id)) {
        body.vertices = undefined;
      }
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

    // Keep snapshots based on current interpolation delay + buffer for jitter calculation
    // Need at least 10 snapshots for adaptive delay calculation, or keep last 2× interpolation delay worth
    const minKeepTime = Math.max(this.interpolationDelay * 2, 500); // At least 500ms or 2× delay
    const cutoff = Date.now() - minKeepTime;
    
    // Use _receivedAt (client clock) consistently, and always keep at least 10 snapshots
    while (this.snapshotBuffer.length > 1 && this.snapshotBuffer[0]._receivedAt! < cutoff) {
      this.snapshotBuffer.shift();
    }
    
    // Limit buffer size to prevent unbounded growth during high latency
    // If buffer exceeds 100 snapshots, we're accumulating too much lag - jump forward
    const maxBufferSize = 100;
    if (this.snapshotBuffer.length > maxBufferSize) {
      const discardCount = this.snapshotBuffer.length - 50; // Keep most recent 50
      this.snapshotBuffer.splice(0, discardCount);
      if (import.meta.env.DEV) console.log(`Discarded ${discardCount} old snapshots to prevent lag accumulation`);
    }
  }

  /**
   * Handle UI update from host (client only) - UI Channel
   */
  private handleUIUpdate(_uiState: UIState): void {
    if (this.role === 'host') return;
    // No UI resource updates in arena mode
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
    const now = Date.now();
    
    // Determine which bodies should have vertices sent this frame
    const bodiesToSendVertices: Set<string> = new Set();
    const bodiesNeedingResend: Array<{ id: string; lastSent: number }> = [];
    
    allBodies.forEach(body => {
      const id = (body as ExtendedBody).customId || `static-${body.id}`;
      const lastSent = this.lastVerticesSent.get(id);
      
      if (!lastSent) {
        // New body - always send vertices
        bodiesToSendVertices.add(id);
      } else if (now - lastSent > this.verticesResendInterval) {
        // Body needs resend
        bodiesNeedingResend.push({ id, lastSent });
      }
    });
    
    // Sort by oldest first and add up to maxVerticesPerFrame
    bodiesNeedingResend.sort((a, b) => a.lastSent - b.lastSent);
    const resendCount = Math.min(this.maxVerticesPerFrame - bodiesToSendVertices.size, bodiesNeedingResend.length);
    for (let i = 0; i < resendCount; i++) {
      bodiesToSendVertices.add(bodiesNeedingResend[i].id);
    }
    
    const snapshot: NetworkSnapshot = {
      timestamp: Date.now(),
      bodies: allBodies.map(body => {
        const id = (body as ExtendedBody).customId || `static-${body.id}`;
        const shouldSendVertices = bodiesToSendVertices.has(id);
        
        if (shouldSendVertices) {
          this.lastVerticesSent.set(id, now);
        }
        
        return {
          id,
          position: { x: body.position.x, y: body.position.y },
          angle: body.angle,
          vertices: shouldSendVertices ? body.vertices.map((v: Matter.Vector) => ({ x: v.x, y: v.y })) : undefined,
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
        };
      }),
      effects: this.effectEvents.length > 0 ? [...this.effectEvents] : undefined,
    };
    
    // Clear effect events after sending
    this.effectEvents = [];
    
    // Clean up tracking for removed bodies
    const currentBodyIds = new Set(snapshot.bodies.map(b => b.id));
    this.lastVerticesSent.forEach((_, id) => {
      if (!currentBodyIds.has(id)) {
        this.lastVerticesSent.delete(id);
      }
    });
    
    return snapshot;
  }

  /**
   * Serialize UI state for network transmission (host only)
   */
  private serializeUIState(): UIState { return { resources: {}, cooldowns: Object.fromEntries(this.buildCooldowns) }; }

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

    // No periodic resource updates in arena mode

    // Detect game over on host
    if (this.role === 'host' && this.physics && !this.gameEnded && this.physics.isGameOver()) {
      this.gameEnded = true;
      const aliveOwners = (this.physics as unknown as { getAliveCoreOwners?: () => string[] }).getAliveCoreOwners?.();
      const deathTimes = (this.physics as unknown as { getCoreDeathTimes?: () => Map<string, number> }).getCoreDeathTimes?.();
      let winner: 'host' | 'client' | 'tie' | null = null;
      if (deathTimes && deathTimes.size >= 2) {
        const times = Array.from(deathTimes.values()).sort();
        if (times[times.length - 1] - times[0] <= 2000) winner = 'tie';
      }
      if (!winner) {
        const myAlive = aliveOwners?.includes(this.playerId);
        const otherAlive = aliveOwners?.some(id => id !== this.playerId);
        if (myAlive && !otherAlive) winner = 'host';
        if (!myAlive && otherAlive) winner = 'client';
      }
      if (!winner) winner = 'tie';
      this.network.sendEvent({ type: 'game-over', winner } as GameEvent);
      if (this.onGameOver) this.onGameOver(winner);
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

    // Client: Log packet rate every second
    if (this.role === 'client' && now - this.lastPacketRateLog >= 1000) {
      this.recentPacketRate = this.recentPacketRate * 0.7 + this.packetsReceivedThisSecond * 0.3;
      this.packetsReceivedThisSecond = 0;
      this.handleStateUpdateCallsThisSecond = 0;
      this.lastPacketRateLog = now;
    }

    // Render
    if (this.role === 'host' && this.physics) {
      // Host renders from physics engine
      this.renderer.renderPhysics(this.physics.getAllBodies());
    } else {
      // Client: render interpolated snapshot with adaptive delay
      let targetDelay = this.calculateAdaptiveDelay();
      
      // If packet rate is very low, reduce interpolation delay to show packets immediately
      // This prevents being stuck far in the past when only getting a few packets/sec
      if (this.recentPacketRate < 8) {
        targetDelay = Math.min(targetDelay, 150); // Cap at 150ms when packet rate is low
        if (import.meta.env.DEV && Math.random() < 0.1) {
          console.log(`Low packet rate (${this.recentPacketRate.toFixed(1)}/sec) - reducing interpolation delay to ${targetDelay}ms`);
        }
      }
      
      // Smoothly adjust delay over time to prevent sudden jumps (1% per frame = ~100 frames to adjust)
      this.interpolationDelay = this.interpolationDelay * 0.99 + targetDelay * 0.01;
      const renderTime = now - this.interpolationDelay;
      const bodies = this.getInterpolatedBodies(renderTime);
      
            this.renderer.renderPhysics(bodies as Matter.Body[]);
    }

    this.animationFrameId = requestAnimationFrame(this.gameLoop);
  };

  /**
   * Calculate adaptive interpolation delay based on network jitter
   */
  private calculateAdaptiveDelay(): number {
    if (this.snapshotBuffer.length < 3) return 300; // fallback to default
    
    // Measure intervals between last N snapshots
    const sampleSize = Math.min(10, this.snapshotBuffer.length);
    const intervals: number[] = [];
    
    for (let i = this.snapshotBuffer.length - sampleSize; i < this.snapshotBuffer.length - 1; i++) {
      const dt = this.snapshotBuffer[i + 1]._receivedAt! - this.snapshotBuffer[i]._receivedAt!;
      intervals.push(dt);
    }
    
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const maxInterval = Math.max(...intervals);
    const variance = intervals.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / intervals.length;
    const jitter = Math.sqrt(variance);
    
    // Use worst-case (max interval) for more stability at high latency
    // This prevents running out of buffer when packets are delayed
    const calculatedDelay = Math.max(avg + (2 * jitter), maxInterval) + 50; // +50ms safety margin
    
    // Clamp between 100ms (low latency) and 1000ms (high latency)
    return Math.max(300, Math.min(1000, calculatedDelay));
  }

  /**
   * Transform cached local vertices to world coordinates
   */
  private transformCachedVertices(bodyId: string, position: { x: number; y: number }, angle: number): Array<{ x: number; y: number }> {
    const localVerts = this.verticesCache.get(bodyId) || [];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return localVerts.map(v => ({
      x: position.x + (v.x * cos - v.y * sin),
      y: position.y + (v.x * sin + v.y * cos)
    }));
  }

  /**
   * Create a fake Matter.Body for rendering
   */
  private createFakeBody(bodyId: string, bodyData: SerializableBody, vertices: Array<{ x: number; y: number }>): Matter.Body {
    const hashId = (s: string): number => {
      let h = 0;
      for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h) + s.charCodeAt(i);
        h |= 0;
      }
      return Math.abs(h) + 1;
    };

    const fakeBody: Partial<Matter.Body> & { id: number } = {
      id: hashId(bodyId),
      position: bodyData.position,
      angle: bodyData.angle,
      vertices,
      circleRadius: bodyData.circleRadius,
      isStatic: bodyData.isStatic,
      render: bodyData.render ?? { fillStyle: '#3498db' },
    };
    return fakeBody as Matter.Body;
  }

  /**
   * Extrapolate bodies forward in time based on velocity from last two snapshots
   */
  private extrapolateBodies(targetTime: number): Matter.Body[] {
    const latest = this.snapshotBuffer[this.snapshotBuffer.length - 1];
    const previous = this.snapshotBuffer[this.snapshotBuffer.length - 2];
    
    const latestTime = (latest.timestamp ?? latest._receivedAt) as number;
    const prevTime = (previous.timestamp ?? previous._receivedAt) as number;
    const dt = (latestTime - prevTime) / 1000; // seconds
    const extrapolationTime = (targetTime - latestTime) / 1000; // seconds to extrapolate
    
    // Limit extrapolation to prevent wild predictions
    const clampedExtrapolation = Math.min(extrapolationTime, 0.2); // max 200ms
    
    const result: Matter.Body[] = [];
    
    latest.bodies.forEach((latestBody) => {
      const prevBody = previous.bodies.find(b => b.id === latestBody.id);
      
      // If body just appeared, don't extrapolate
      if (!prevBody || dt === 0) {
        const vertices = latestBody.vertices || this.transformCachedVertices(latestBody.id, latestBody.position, latestBody.angle);
        result.push(this.createFakeBody(latestBody.id, latestBody, vertices));
        return;
      }
      
      // Static bodies don't move
      if (latestBody.isStatic) {
        const vertices = latestBody.vertices || this.transformCachedVertices(latestBody.id, latestBody.position, latestBody.angle);
        result.push(this.createFakeBody(latestBody.id, latestBody, vertices));
        return;
      }
      
      // Calculate velocity
      const vx = (latestBody.position.x - prevBody.position.x) / dt;
      const vy = (latestBody.position.y - prevBody.position.y) / dt;
      const angularV = (latestBody.angle - prevBody.angle) / dt;
      
      // Extrapolate position
      const extrapolatedBody: SerializableBody = {
        ...latestBody,
        position: {
          x: latestBody.position.x + vx * clampedExtrapolation,
          y: latestBody.position.y + vy * clampedExtrapolation,
        },
        angle: latestBody.angle + angularV * clampedExtrapolation,
      };
      
      const vertices = this.transformCachedVertices(latestBody.id, extrapolatedBody.position, extrapolatedBody.angle);
      result.push(this.createFakeBody(latestBody.id, extrapolatedBody, vertices));
    });
    
    return result;
  }

  /**
   * Build interpolated Matter-like bodies for rendering on the client
   */
  private getInterpolatedBodies(targetTime: number): Matter.Body[] {
    if (this.snapshotBuffer.length === 0) {
      return Array.from(this.bodies.values());
    }

    const latestSnapshot = this.snapshotBuffer[this.snapshotBuffer.length - 1];
    // Use _receivedAt exclusively to avoid clock skew between host and client
    const latestTime = latestSnapshot._receivedAt!;
    
    // If targetTime is past our latest snapshot, just hold at latest position
    // (Extrapolation causes wobble when transitioning back to interpolation)
    if (targetTime > latestTime) {
      targetTime = latestTime; // Clamp to latest available
    }

    // Buffer is kept ordered on push; no per-frame sort

    // Find snapshots bracketing targetTime
    let prev = this.snapshotBuffer[this.snapshotBuffer.length - 1];
    let next = this.snapshotBuffer[this.snapshotBuffer.length - 1];
    let foundBracket = false;

    for (let i = 0; i < this.snapshotBuffer.length - 1; i++) {
      const a = this.snapshotBuffer[i];
      const b = this.snapshotBuffer[i + 1];
      // Use _receivedAt exclusively to avoid clock skew between host and client
      const ta = a._receivedAt!;
      const tb = b._receivedAt!;
      if (ta <= targetTime && targetTime <= tb) {
        prev = a;
        next = b;
        foundBracket = true;
        break;
      }
    }

    // If no bracket found (targetTime too old), just use latest snapshot
    if (!foundBracket) {
      prev = this.snapshotBuffer[this.snapshotBuffer.length - 1];
      next = this.snapshotBuffer[this.snapshotBuffer.length - 1];
    }

    // Use _receivedAt exclusively to avoid clock skew between host and client
    const tPrev = prev._receivedAt!;
    const tNext = next._receivedAt!;
    const alpha = tNext > tPrev ? (targetTime - tPrev) / (tNext - tPrev) : 0;
    const clampedAlpha = Math.max(0, Math.min(1, alpha));
    
    // Apply smootherstep for smoother interpolation
    const smoothAlpha = clampedAlpha * clampedAlpha * clampedAlpha * (clampedAlpha * (clampedAlpha * 6 - 15) + 10);

    // Index bodies by id for prev/next
    const prevMap: Map<string, SerializableBody> = new Map(prev.bodies.map((b) => [b.id, b]));
    const nextMap: Map<string, SerializableBody> = new Map(next.bodies.map((b) => [b.id, b]));
    const ids = new Set<string>();
    prevMap.forEach((_, id) => ids.add(id));
    nextMap.forEach((_, id) => ids.add(id));

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

    ids.forEach((id) => {
      const a = prevMap.get(id) || nextMap.get(id);
      const b = nextMap.get(id) || prevMap.get(id);
      if (!a || !b) return;

      // Skip interpolation for static bodies - just use latest position
      if (a.isStatic) {
        const vertices = b.vertices || this.transformCachedVertices(id, b.position, b.angle);
        result.push(this.createFakeBody(id, b, vertices));
        return;
      }

      const lerp = (x: number, y: number, t: number) => x + (y - x) * t;

      const pos = {
        x: lerp(a.position.x, b.position.x, smoothAlpha),
        y: lerp(a.position.y, b.position.y, smoothAlpha),
      };

      // Shortest-arc angle lerp
      let d = b.angle - a.angle;
      d = ((d + Math.PI) % (2 * Math.PI)) - Math.PI;
      const angle = a.angle + d * smoothAlpha;

      // Get vertices: use from snapshot if available, otherwise transform cached local vertices
      let vertices: Array<{ x: number; y: number }>;
      if (a.vertices || b.vertices) {
        vertices = a.vertices || b.vertices || [];
      } else {
        // Transform cached local vertices to world coordinates using current position/angle
        const localVerts = this.verticesCache.get(id) || [];
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        vertices = localVerts.map(v => ({
          x: pos.x + (v.x * cos - v.y * sin),
          y: pos.y + (v.x * sin + v.y * cos)
        }));
      }

      const fakeBody: Partial<Matter.Body> & { id: number } = {
        id: hashId(id),
        position: pos,
        angle,
        vertices,
        circleRadius: a.circleRadius ?? b.circleRadius,
        isStatic: a.isStatic ?? b.isStatic,
        render: a.render ?? b.render ?? { fillStyle: '#3498db' },
      };
      result.push(fakeBody as Matter.Body);
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
    return { mine: 0, enemy: 0 };
  }

  private setupInputHandlers(): void {
    let current = 0;
    const send = (v: number) => {
      if (v === current) return;
      current = v;
      if (this.role === 'host') {
        // Apply locally on host
        this.physics?.setWheelInput(this.playerId, v);
      } else {
        // Send to host (no mirroring; host uses driveDir)
        const cmd: WheelInputCommand = { type: 'wheel-input', playerId: this.playerId, value: v };
        this.network.sendCommand(cmd as unknown as GameCommand);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === 'a' || e.key === 'A') send(1);
      if (e.key === 'd' || e.key === 'D') send(-1);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'a' || e.key === 'A') send(0);
      if (e.key === 'd' || e.key === 'D') send(0);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
  }
}

