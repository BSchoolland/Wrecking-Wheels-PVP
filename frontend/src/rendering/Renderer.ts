/**
 * Canvas Renderer
 * Pure function: renders game state to canvas
 */

import type { GameState } from '@shared/types/GameState';
import { WORLD_BOUNDS } from '@shared/constants/physics';
import { Camera } from '@/core/Camera';
import { EffectManager } from './EffectManager';
import type { BaseBlock } from '@/game/contraptions/blocks/BaseBlock';
import type * as Matter from 'matter-js';
import { CONTRAPTION_DEBUG } from '@/game/contraptions';

// Camera tuning constants (no magic numbers)
const CAMERA_SMOOTHING = 0.02; // 0-1, higher is snappier
const CAMERA_DEADZONE_PX = 30; // pixels from screen center before camera moves

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  public camera: Camera;
  public effects: EffectManager;
  private onResizeHandler = () => this.resizeCanvas();
  private lastFrameTime = performance.now();
  private playerRole: 'host' | 'client' | null = null;
  private myPlayerId: string | null = null;
  private battleCameraInitialized = false;
  private baseZoom: number | null = null;
  private lastFollowX: number | null = null;
  private lastFollowY: number | null = null;
  private lastFollowT: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context');
    this.ctx = ctx;

    this.camera = new Camera({ canvas });
    this.effects = new EffectManager();
    this.resizeCanvas();
    window.addEventListener('resize', this.onResizeHandler);
  }

  setPlayerRole(role: 'host' | 'client'): void {
    this.playerRole = role;
  }

  setPlayerId(playerId: string): void {
    this.myPlayerId = playerId;
  }

  private resizeCanvas(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.camera?.onResize();
  }

  /**
   * Render the game state
   */
  render(state: GameState): void {
    this.clear();
    this.setupCamera();

    // Render terrain
    this.renderTerrain(state);

    // Render contraptions
    this.renderContraptions(state);

    // Render HUD (not affected by camera)
    this.resetCamera();
    this.renderHUD(state);
  }

  private clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Background
    this.ctx.fillStyle = '#87CEEB'; // Sky blue
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private setupCamera(): void {
    this.ctx.save();
    this.camera.applyTransform(this.ctx);
  }

  private resetCamera(): void {
    this.ctx.restore();
  }

  private renderTerrain(state: GameState): void {
    // Render ground
    this.ctx.fillStyle = '#8B7355'; // Brown
    this.ctx.fillRect(0, WORLD_BOUNDS.HEIGHT, WORLD_BOUNDS.WIDTH, 50);

    // Render obstacles
    state.terrain.obstacles.forEach(obstacle => {
      this.ctx.fillStyle = '#555555';
      this.ctx.fillRect(
        obstacle.position.x - obstacle.width / 2,
        obstacle.position.y - obstacle.height / 2,
        obstacle.width,
        obstacle.height
      );
    });
  }

  private renderContraptions(state: GameState): void {
    Object.values(state.contraptions).forEach(contraption => {
      this.ctx.save();
      
      // Translate to contraption position
      this.ctx.translate(contraption.position.x, contraption.position.y);
      this.ctx.rotate(contraption.rotation);

      // Render contraption (simple box for now)
      this.ctx.fillStyle = contraption.ownerId === Object.keys(state.players)[0] ? '#4CAF50' : '#F44336';
      this.ctx.fillRect(-20, -20, 40, 40);

      this.ctx.restore();
    });
  }

  private renderHUD(state: GameState): void {
    // Render player resources
    let y = 20;
    Object.values(state.players).forEach(player => {
      this.ctx.fillStyle = '#000000';
      this.ctx.font = '16px Arial';
      this.ctx.fillText(`${player.name}: ${Math.floor(player.resources)} resources`, 20, y);
      y += 30;
    });

    // Render match time
    const minutes = Math.floor(state.matchDuration / 60);
    const seconds = Math.floor(state.matchDuration % 60);
    this.ctx.fillText(`Time: ${minutes}:${seconds.toString().padStart(2, '0')}`, 20, y);

    // Render winner if game is over
    if (state.winner) {
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      
      const winner = state.players[state.winner];
      this.ctx.fillStyle = '#FFFFFF';
      this.ctx.font = 'bold 48px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(
        `${winner?.name} Wins!`,
        this.canvas.width / 2,
        this.canvas.height / 2
      );
      this.ctx.textAlign = 'left';
    }
  }

  private updateBattleCamera(bodies: Matter.Body[], now: number): void {
    if (!this.myPlayerId) return;
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const body of bodies) {
      const ownerId = (body as unknown as { ownerId?: string }).ownerId;
      if (ownerId === this.myPlayerId && !(body as unknown as { isStatic?: boolean }).isStatic) {
        sumX += (body as unknown as { position: { x: number } }).position.x;
        sumY += (body as unknown as { position: { y: number } }).position.y;
        count++;
      }
    }
    if (count === 0) return;

    const targetX = sumX / count;
    const targetY = sumY / count;

    // Deadzone calculation in screen space
    const playerScreen = this.camera.worldToScreen(targetX, targetY);
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;
    let desiredCamX = this.camera.x;
    let desiredCamY = this.camera.y;
    const dx = playerScreen.x - centerX;
    const dy = playerScreen.y - centerY;
    const deadX = CAMERA_DEADZONE_PX;
    const deadY = CAMERA_DEADZONE_PX * 0.6;
    if (Math.abs(dx) > deadX) {
      const excessX = Math.abs(dx) - deadX;
      const dirX = this.camera.mirrorX ? -Math.sign(dx) : Math.sign(dx);
      const worldShiftX = (excessX / this.camera.zoom) * dirX;
      desiredCamX += worldShiftX;
    }
    if (Math.abs(dy) > deadY) {
      const excessY = Math.abs(dy) - deadY;
      const worldShiftY = (excessY / this.camera.zoom) * Math.sign(dy);
      desiredCamY += worldShiftY;
    }

    // Smoothly move camera toward desired position
    this.camera.x += (desiredCamX - this.camera.x) * CAMERA_SMOOTHING;
    this.camera.y += (desiredCamY - this.camera.y) * CAMERA_SMOOTHING;
    this.lastFollowX = targetX;
    this.lastFollowY = targetY;
    this.lastFollowT = now;
  }

  /**
   * Render Matter.js bodies directly (for demo/testing)
   */
  renderPhysics(bodies: Matter.Body[]): void {
    // Update effects
    const now = performance.now();
    const deltaTime = now - this.lastFrameTime;
    this.lastFrameTime = now;
    this.effects.update(deltaTime);

    // Disable manual camera controls during battle (once)
    if (!this.battleCameraInitialized) {
      this.camera.setControlsEnabled(false);
      this.battleCameraInitialized = true;
      if (this.baseZoom === null) {
        this.baseZoom = this.camera.zoom * 3; // start 3x more zoomed in for battle
        this.camera.zoom = this.baseZoom; // apply immediately
      }
    }

    // Focus camera on my contraption (smooth follow with deadzone and auto-zoom)
    this.updateBattleCamera(bodies, now);

    this.clear();
    this.setupCamera();

    // Render all bodies
    bodies.forEach(body => {
      this.ctx.save();

      // Early exit for destroyed bases
      const renderOpts = body.render as Matter.IBodyRenderOptions & { healthPercent?: number };
      const hp = renderOpts?.healthPercent;
      if (body.label?.includes('base-') && hp !== undefined && hp <= 0) {
        this.ctx.restore();
        return;
      }

      // Get fill color from render options or use default
      let fillStyle = renderOpts?.fillStyle ||
        (body.isStatic ? '#555555' : '#3498db');

      // Override base colors based on player role (always show your base as blue, enemy as red)
      if (body.label === 'base-host') {
        fillStyle = this.playerRole === 'host' ? 'rgba(52,152,219,0.35)' : 'rgba(231,76,60,0.35)';
      } else if (body.label === 'base-client') {
        fillStyle = this.playerRole === 'client' ? 'rgba(52,152,219,0.35)' : 'rgba(231,76,60,0.35)';
      }

      this.ctx.fillStyle = fillStyle;
      this.ctx.strokeStyle = '#000000';
      this.ctx.lineWidth = 2;

      // Render based on body type
      if (body.circleRadius) {
        // Circle
        this.ctx.beginPath();
        this.ctx.arc(body.position.x, body.position.y, body.circleRadius, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();
        
        // Draw a line to show rotation
        this.ctx.beginPath();
        this.ctx.moveTo(body.position.x, body.position.y);
        this.ctx.lineTo(
          body.position.x + Math.cos(body.angle) * body.circleRadius,
          body.position.y + Math.sin(body.angle) * body.circleRadius
        );
        this.ctx.stroke();
      } else {
        // Polygon
        const vertices = body.vertices;
        if (!vertices || vertices.length === 0) {
          this.ctx.restore();
          return;
        }
        this.ctx.beginPath();
        this.ctx.moveTo(vertices[0].x, vertices[0].y);
        for (let i = 1; i < vertices.length; i++) {
          this.ctx.lineTo(vertices[i].x, vertices[i].y);
        }
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();
      }

      // Apply tint overlay if damaged
      const hasTint = this.effects.renderBlockTint(this.ctx, body);
      if (hasTint) {
        // Re-render shape with tint
        if (body.circleRadius) {
          this.ctx.beginPath();
          this.ctx.arc(body.position.x, body.position.y, body.circleRadius, 0, Math.PI * 2);
          this.ctx.fill();
        } else {
          const vertices = body.vertices;
          if (!vertices || vertices.length === 0) {
            this.ctx.globalAlpha = 1;
            this.ctx.restore();
            return;
          }
          this.ctx.beginPath();
          this.ctx.moveTo(vertices[0].x, vertices[0].y);
          for (let i = 1; i < vertices.length; i++) {
            this.ctx.lineTo(vertices[i].x, vertices[i].y);
          }
          this.ctx.closePath();
          this.ctx.fill();
        }
        this.ctx.globalAlpha = 1;
      }

      // Render damage cracks (host or client): compute healthPercent from available source
      const block = (body as unknown as { block?: BaseBlock }).block;
      const crackHp: number | undefined = block
        ? Math.max(0, Math.min(1, block.health / block.maxHealth))
        : renderOpts?.healthPercent;
      this.effects.renderDamageCracksByPercent(this.ctx, body, crackHp);

      this.ctx.restore();
    });

    // Render ghost blocks
    this.effects.renderGhostBlocks(this.ctx);

    // Draw wheel glow overlays for local player's wheels
    this.effects.renderWheelGlows(this.ctx, bodies, this.myPlayerId);

    // Render particles and damage numbers
    this.effects.render(this.ctx);

    this.resetCamera();
  }

  /**
   * Render constraints as lines for debugging
   */
  renderConstraints(constraints: Matter.Constraint[]): void {
    if (!CONTRAPTION_DEBUG || constraints.length === 0) return;
    this.setupCamera();
    this.ctx.strokeStyle = '#00ffff';
    this.ctx.lineWidth = 4;
    this.ctx.shadowBlur = 10;
    this.ctx.shadowColor = 'rgba(0,255,255,0.9)';
    constraints.forEach(c => {
      const a = c.bodyA;
      const b = c.bodyB;
      if (!a || !b || !c.pointA || !c.pointB) return;
      const ax = a.position.x + (c.pointA.x || 0);
      const ay = a.position.y + (c.pointA.y || 0);
      const bx = b.position.x + (c.pointB.x || 0);
      const by = b.position.y + (c.pointB.y || 0);
      this.ctx.beginPath();
      this.ctx.moveTo(ax, ay);
      this.ctx.lineTo(bx, by);
      this.ctx.stroke();

      // Endpoint nodes
      this.ctx.beginPath();
      this.ctx.arc(ax, ay, 4, 0, Math.PI * 2);
      this.ctx.arc(bx, by, 4, 0, Math.PI * 2);
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fill();
      this.ctx.stroke();
    });
    this.ctx.shadowBlur = 0;
    this.resetCamera();
  }

  /**
   * Clean up
   */
  destroy(): void {
    window.removeEventListener('resize', this.onResizeHandler);
    this.effects.clear();
    this.camera.destroy();
  }
}
