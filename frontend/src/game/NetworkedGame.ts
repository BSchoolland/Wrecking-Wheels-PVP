/**
 * Networked Game - Handles both host and client modes
 */

import { PhysicsEngine } from '@/core/physics/PhysicsEngine';
import { Renderer } from '@/rendering/Renderer';
import { NetworkManager, NetworkRole } from '@/core/networking/NetworkManager';
import type { SpawnBoxCommand, GameCommand, ContraptionData } from '@shared/types/Commands';
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
  vertices: Array<{ x: number; y: number }>;
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
  baseHostHp?: number;
  baseClientHp?: number;
  winner?: 'host' | 'client';
  resources?: { [playerId: string]: { material: number; energy: number } };
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
  private syncInterval = 50; // Send state updates every 50ms (20 times per second)
  
  // Effect events to sync (host only)
  private effectEvents: EffectEvent[] = [];

  // Client-side interpolation buffer
  private snapshotBuffer: NetworkSnapshot[] = [];
  private interpolationDelay = 100; // ms to buffer behind for smoothness

  private latestSnapshot: NetworkSnapshot | null = null;
  private gameEnded = false;
  private winner: 'host' | 'client' | null = null;
  private onGameOver?: (winner: 'host' | 'client') => void;

  // Cooldowns per player
  private buildCooldowns: Map<string, number> = new Map();

  // Resources per player
  private playerResources: Map<string, { material: number; energy: number }> = new Map();
  private lastResourceUpdate = 0;
  // Change the resource update interval and amount
  private resourceUpdateInterval = 200; // 0.2 seconds
  private resourceGainPerSecond = 0.4; // units per second for both material and energy

  constructor(config: NetworkedGameConfig) {
    this.canvas = config.canvas;
    this.role = config.role;
    this.playerId = config.playerId;
    this.savedContraption = config.contraption;
    this.onContraptionSpawned = config.onContraptionSpawned;
    this.onGameOver = config.onGameOver;
    
    // Initialize resources for this player
    this.playerResources.set(this.playerId, { material: 0.0, energy: 0.0 });
    this.lastResourceUpdate = Date.now();
    
    // Initialize renderer
    this.renderer = new Renderer(this.canvas);
    // Mirror view for clients so they perceive themselves on the right moving left
    if (this.role === 'client') {
      this.renderer.camera.mirrorX = true;
    }
    
    // Initialize physics (host only)
    if (this.role === 'host') {
      this.physics = new PhysicsEngine();
      this.physics.setEffectManager(this.renderer.effects);
      this.physics.setBaseOwner('host', this.playerId);
      this.setupEffectCapture();
      this.physics.start();
    }
    
    // Initialize networking
    const signalingUrl = import.meta.env.VITE_SIGNALING_URL || 'ws://localhost:3001';
    this.network = new NetworkManager({
      role: this.role,
      lobbyId: config.lobbyId,
      signalingServerUrl: signalingUrl,
      onStateUpdate: (state) => this.handleStateUpdate(state),
      onCommand: (command) => this.handleCommand(command),
      onConnected: () => { if (import.meta.env.DEV) console.log('Peer connected!'); },
      onDisconnected: () => { if (import.meta.env.DEV) console.log('Peer disconnected!'); },
    });

    // Set up click handler
    this.setupClickHandler();
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
    this.canvas.addEventListener('click', (e) => {
      // Only spawn on left click (button 0 or undefined)
      if (e.button !== undefined && e.button !== 0) return;

      // Check if on cooldown
      const cooldownEnd = this.buildCooldowns.get(this.playerId) || 0;
      if (Date.now() < cooldownEnd) return;

      // Check resources before spawning
      if (!this.savedContraption) return;
      const contraption = new Contraption('temp', 'temp');
      this.savedContraption.blocks.forEach(blockData => {
        const block = blockFromData(blockData as BlockData);
        contraption.addBlock(block);
      });
      const cost = contraption.getCost();
      
      const currentResources = this.playerResources.get(this.playerId);
      if (!currentResources || currentResources.material < cost.material || currentResources.energy < cost.energy) {
        return;
      }

      // Convert screen coordinates to world coordinates using camera
      const worldPos = this.renderer.camera.screenToWorld(e.clientX, e.clientY);
      
      const command: SpawnBoxCommand = {
        type: 'spawn-box',
        playerId: this.playerId,
        position: { x: worldPos.x, y: 450 },
        contraption: this.savedContraption!,
      };

      // If host, execute command immediately
      if (this.role === 'host') {
        this.handleCommand(command);
      } else {
        // If client, send to host
        this.network.sendCommand(command);
      }
      if (this.onContraptionSpawned) this.onContraptionSpawned();
    });
  }

  /**
   * Handle incoming commands (host only)
   */
  private handleCommand(command: GameCommand): void {
    if (this.role !== 'host' || !this.physics) return;

    if (this.physics.isGameOver()) return;

    switch (command.type) {
      case 'spawn-box':
        if (command.playerId !== this.playerId) {
          this.physics.setBaseOwner('client', command.playerId);
        }
        this.spawnContraption(command.position.x, command.position.y, command.playerId, command.contraption);
        break;
    }
  }

  /**
   * Spawn a contraption in the physics world (host only)
   */
  private spawnContraption(x: number, y: number, playerId: string, contraptionData: ContraptionData): void {
    if (!this.physics) return;

    // Initialize resources for other player if not yet initialized
    if (!this.playerResources.has(playerId)) {
      this.playerResources.set(playerId, { material: 0.0, energy: 0.0 });
    }

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

    // Calculate build duration and set cooldown
    const blockCount = contraptionData.blocks.length;
    const durationMs = 500 + blockCount * 50;
    const buildRadius = 40 + Math.sqrt(blockCount) * 10; // Scale with contraption size
    this.buildCooldowns.set(playerId, Date.now() + durationMs);

    // Calculate and deduct resources
    const tempContraption = new Contraption('temp', 'temp');
    contraptionData.blocks.forEach(blockData => {
      const block = blockFromData(blockData as BlockData);
      tempContraption.addBlock(block);
    });
    const cost = tempContraption.getCost();
    
    const currentResources = this.playerResources.get(playerId);
    if (currentResources) {
      currentResources.material -= cost.material;
      currentResources.energy -= cost.energy;
      this.playerResources.set(playerId, currentResources);
    }

    // Trigger building dust effect (for host and sync to client)
    this.renderer.effects.spawnBuildingDust(clampedX, y, durationMs, buildRadius);
    this.effectEvents.push({
      type: 'building',
      x: clampedX,
      y,
      durationMs,
      radius: buildRadius,
      playerId,
    });

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
   * Handle state update from host (client only)
   */
  private handleStateUpdate(state: GameState): void {
    if (this.role === 'host') return;
    // Treat incoming state as a network snapshot for interpolation
    const snapshot = { ...(state as unknown as NetworkSnapshot), _receivedAt: Date.now() } as NetworkSnapshot;
    this.snapshotBuffer.push(snapshot);
    this.latestSnapshot = snapshot;

    // Update resources from snapshot
    if (snapshot.resources) {
      Object.entries(snapshot.resources).forEach(([playerId, resources]) => {
        this.playerResources.set(playerId, resources);
      });
    }

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

    // Keep only the last ~1s of snapshots
    const cutoff = Date.now() - 1000;
    while (this.snapshotBuffer.length && ((this.snapshotBuffer[0].timestamp ?? this.snapshotBuffer[0]._receivedAt) as number) < cutoff) {
      this.snapshotBuffer.shift();
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
      bodies: allBodies.map(body => ({
        id: (body as ExtendedBody).customId || `static-${body.id}`,
        position: { x: body.position.x, y: body.position.y },
        angle: body.angle,
        vertices: body.vertices.map((v: Matter.Vector) => ({ x: v.x, y: v.y })),
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
      })),
      effects: this.effectEvents.length > 0 ? [...this.effectEvents] : undefined,
      baseHostHp: this.physics!.getBaseHp('host'),
      baseClientHp: this.physics!.getBaseHp('client'),
      winner: this.gameEnded && this.winner ? this.winner : undefined,
      resources: Object.fromEntries(this.playerResources),
    };
    
    // Clear effect events after sending
    this.effectEvents = [];
    
    return snapshot;
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
   * Main game loop
   */
  private gameLoop = (): void => {
    if (!this.isRunning) return;

    const now = Date.now();

    // Update resources periodically (host only)
    if (this.role === 'host' && now - this.lastResourceUpdate >= this.resourceUpdateInterval) {
      const intervalSeconds = this.resourceUpdateInterval / 1000;
      const increment = this.resourceGainPerSecond * intervalSeconds;
      this.playerResources.forEach((resources, playerId) => {
        resources.material = Math.min(10, resources.material + increment);
        resources.energy = Math.min(10, resources.energy + increment);
        this.playerResources.set(playerId, resources);
      });
      this.lastResourceUpdate = now;
    }

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
      this.winner = winner;
      if (this.onGameOver && winner) {
        this.onGameOver(winner);
      }
    }

    // Host: sync state to client periodically
    if (this.role === 'host' && this.network.isConnected()) {
      if (now - this.lastSyncTime >= this.syncInterval) {
        const state = this.serializeState();
        if (state) {
          this.network.sendState(state as unknown);
          this.lastSyncTime = now;
        }
      }
    }

    // Render
    if (this.role === 'host' && this.physics) {
      // Host renders from physics engine
      this.renderer.renderPhysics(this.physics.getAllBodies());
    } else {
      // Client: render interpolated snapshot
      const renderTime = now - this.interpolationDelay;
      const bodies = this.getInterpolatedBodies(renderTime);
      
      // Detect game over on client
      if (this.latestSnapshot?.winner && !this.gameEnded) {
        this.gameEnded = true;
        if (this.onGameOver) {
          this.onGameOver(this.latestSnapshot.winner);
        }
      }
      
      this.renderer.renderPhysics(bodies as Matter.Body[]);
    }

    if (this.role === 'host' && this.physics) {
      const hostHp = this.physics.getBaseHp('host');
      const clientHp = this.physics.getBaseHp('client');
      this.renderer.renderBaseHealthbars(hostHp, clientHp);
    } else {
      const hostHp = this.latestSnapshot?.baseHostHp ?? 10;
      const clientHp = this.latestSnapshot?.baseClientHp ?? 10;
      this.renderer.renderBaseHealthbars(hostHp, clientHp);
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

    // Buffer is kept ordered on push; no per-frame sort

    // Find snapshots bracketing targetTime
    let prev = this.snapshotBuffer[0];
    let next = this.snapshotBuffer[this.snapshotBuffer.length - 1];

    for (let i = 0; i < this.snapshotBuffer.length - 1; i++) {
      const a = this.snapshotBuffer[i];
      const b = this.snapshotBuffer[i + 1];
      const ta = (a.timestamp ?? a._receivedAt);
      const tb = (b.timestamp ?? b._receivedAt);
      if (ta <= targetTime && targetTime <= tb) {
        prev = a;
        next = b;
        break;
      }
    }

    const tPrev = (prev.timestamp ?? prev._receivedAt);
    const tNext = (next.timestamp ?? next._receivedAt);
    const alpha = tNext > tPrev ? (targetTime - tPrev) / (tNext - tPrev) : 0;
    const clampedAlpha = Math.max(0, Math.min(1, alpha));

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

      const lerp = (x: number, y: number, t: number) => x + (y - x) * t;

      const pos = {
        x: lerp(a.position.x, b.position.x, clampedAlpha),
        y: lerp(a.position.y, b.position.y, clampedAlpha),
      };

      // Shortest-arc angle lerp
      let d = b.angle - a.angle;
      d = ((d + Math.PI) % (2 * Math.PI)) - Math.PI;
      const angle = a.angle + d * clampedAlpha;

      // Interpolate vertices if provided; else approximate from pos/angle not needed for boxes
      const vertices = (a.vertices && b.vertices && a.vertices.length === b.vertices.length)
        ? a.vertices.map((va, i) => ({
            x: lerp(va.x, b.vertices[i].x, clampedAlpha),
            y: lerp(va.y, b.vertices[i].y, clampedAlpha),
          }))
        : (a.vertices || b.vertices || []);

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

  getPlayerResources(playerId: string): { material: number; energy: number } | null {
    return this.playerResources.get(playerId) || null;
  }
}
