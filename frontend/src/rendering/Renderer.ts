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

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  public camera: Camera;
  public effects: EffectManager;
  private onResizeHandler = () => this.resizeCanvas();
  private lastFrameTime = performance.now();
  private playerRole: 'host' | 'client' | null = null;

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

  /**
   * Render Matter.js bodies directly (for demo/testing)
   */
  renderPhysics(bodies: Matter.Body[]): void {
    // Update effects
    const now = performance.now();
    const deltaTime = now - this.lastFrameTime;
    this.lastFrameTime = now;
    this.effects.update(deltaTime);

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

    // Render particles and damage numbers
    this.effects.render(this.ctx);

    this.resetCamera();
  }

  /**
   * Clean up
   */
  destroy(): void {
    window.removeEventListener('resize', this.onResizeHandler);
    this.camera.destroy();
    this.effects.clear();
  }
}
