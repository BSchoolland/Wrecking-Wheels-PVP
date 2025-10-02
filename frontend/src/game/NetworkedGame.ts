/**
 * Networked Game - Handles both host and client modes
 */

import { PhysicsEngine } from '@/core/physics/PhysicsEngine';
import { Renderer } from '@/rendering/Renderer';
import { NetworkManager, NetworkRole } from '@/core/networking/NetworkManager';
import type { SpawnBoxCommand } from '@shared/types/Commands';
import type * as Matter from 'matter-js';

interface NetworkedGameConfig {
  canvas: HTMLCanvasElement;
  role: NetworkRole;
  lobbyId: string;
  playerId: string;
}

export class NetworkedGame {
  private canvas: HTMLCanvasElement;
  private role: NetworkRole;
  private playerId: string;
  
  private physics: PhysicsEngine | null = null;
  private renderer: Renderer;
  private network: NetworkManager;
  
  private isRunning = false;
  private animationFrameId: number | null = null;
  
  // Track bodies for state sync
  private bodies: Map<string, Matter.Body> = new Map();
  private lastSyncTime = 0;
  private syncInterval = 50; // Send state updates every 50ms (20 times per second)

  // Client-side interpolation buffer
  private snapshotBuffer: any[] = [];
  private interpolationDelay = 100; // ms to buffer behind for smoothness

  constructor(config: NetworkedGameConfig) {
    this.canvas = config.canvas;
    this.role = config.role;
    this.playerId = config.playerId;
    
    // Initialize renderer
    this.renderer = new Renderer(this.canvas);
    
    // Initialize physics (host only)
    if (this.role === 'host') {
      this.physics = new PhysicsEngine();
      this.physics.setEffectManager(this.renderer.effects);
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
   * Set up click handler to spawn boxes
   */
  private setupClickHandler(): void {
    this.canvas.addEventListener('click', (e) => {
      // Only spawn on left click (button 0 or undefined)
      if (e.button !== undefined && e.button !== 0) return;

      // Convert screen coordinates to world coordinates using camera
      const worldPos = this.renderer.camera.screenToWorld(e.clientX, e.clientY);
      
      const command: SpawnBoxCommand = {
        type: 'spawn-box',
        playerId: this.playerId,
        position: worldPos,
      };

      // If host, execute command immediately
      if (this.role === 'host') {
        this.handleCommand(command);
      } else {
        // If client, send to host
        this.network.sendCommand(command);
      }
    });
  }

  /**
   * Handle incoming commands (host only)
   */
  private handleCommand(command: any): void {
    if (this.role !== 'host' || !this.physics) return;

    switch (command.type) {
      case 'spawn-box':
        this.spawnBox(command.position.x, command.position.y, command.playerId);
        break;
    }
  }

  /**
   * Spawn a box in the physics world (host only)
   */
  private spawnBox(x: number, y: number, playerId: string): void {
    if (!this.physics) return;

    const boxId = `box-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const color = playerId === this.playerId ? '#3498db' : '#e74c3c';
    
    const box = this.physics.createBox(x, y, 50, 50, {
      restitution: 0.4,
      friction: 0.3,
      render: { fillStyle: color },
    });

    (box as any).customId = boxId;
    (box as any).ownerId = playerId;
    
    this.physics.addBody(box);
    this.bodies.set(boxId, box);
    
    if (import.meta.env.DEV) console.log('Spawned box at', x, y, 'for player', playerId);
  }

  /**
   * Handle state update from host (client only)
   */
  private handleStateUpdate(state: any): void {
    if (this.role === 'host') return;
    // Push snapshot with receipt time as fallback
    const snapshot = { ...state, _receivedAt: Date.now() };
    this.snapshotBuffer.push(snapshot);

    // Keep only the last ~1s of snapshots
    const cutoff = Date.now() - 1000;
    while (this.snapshotBuffer.length && (this.snapshotBuffer[0].timestamp ?? this.snapshotBuffer[0]._receivedAt) < cutoff) {
      this.snapshotBuffer.shift();
    }
  }

  /**
   * Serialize physics state for network transmission (host only)
   */
  private serializeState(): any {
    if (!this.physics) return null;

    const allBodies = this.physics.getAllBodies();
    
    return {
      timestamp: Date.now(),
      bodies: allBodies.map(body => ({
        id: (body as any).customId || `static-${body.id}`,
        position: { x: body.position.x, y: body.position.y },
        angle: body.angle,
        vertices: body.vertices.map((v: any) => ({ x: v.x, y: v.y })),
        circleRadius: body.circleRadius,
        isStatic: body.isStatic,
        render: {
          fillStyle: (body.render as any)?.fillStyle || (body.isStatic ? '#555555' : '#3498db')
        },
      })),
    };
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

    // Host: sync state to client periodically
    if (this.role === 'host' && this.network.isConnected()) {
      if (now - this.lastSyncTime >= this.syncInterval) {
        const state = this.serializeState();
        if (state) {
          this.network.sendState(state);
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
      this.renderer.renderPhysics(bodies as Matter.Body[]);
    }

    this.animationFrameId = requestAnimationFrame(this.gameLoop);
  };

  /**
   * Build interpolated Matter-like bodies for rendering on the client
   */
  private getInterpolatedBodies(targetTime: number): any[] {
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
    const prevMap: Map<string, any> = new Map(prev.bodies.map((b: any) => [b.id, b]));
    const nextMap: Map<string, any> = new Map(next.bodies.map((b: any) => [b.id, b]));
    const ids = new Set<string>();
    prevMap.forEach((_, id) => ids.add(id));
    nextMap.forEach((_, id) => ids.add(id));

    const result: any[] = [];
    ids.forEach((id) => {
      const a: any = prevMap.get(id) || nextMap.get(id);
      const b: any = nextMap.get(id) || prevMap.get(id);
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
        ? a.vertices.map((va: any, i: number) => ({
            x: lerp(va.x, b.vertices[i].x, clampedAlpha),
            y: lerp(va.y, b.vertices[i].y, clampedAlpha),
          }))
        : (a.vertices || b.vertices || []);

      const fakeBody: any = {
        position: pos,
        angle,
        vertices,
        circleRadius: a.circleRadius ?? b.circleRadius,
        isStatic: a.isStatic ?? b.isStatic,
        render: a.render ?? b.render,
      };
      result.push(fakeBody);
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
}
