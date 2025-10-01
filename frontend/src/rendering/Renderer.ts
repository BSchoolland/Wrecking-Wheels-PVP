/**
 * Canvas Renderer
 * Pure function: renders game state to canvas
 */

import type { GameState } from '@shared/types/GameState';
import { WORLD_BOUNDS } from '@shared/constants/physics';
import type Matter from 'matter-js';

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private camera = { x: WORLD_BOUNDS.WIDTH / 2, y: WORLD_BOUNDS.HEIGHT / 2, zoom: 0.8 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context');
    this.ctx = ctx;

    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  private resizeCanvas(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
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
    this.ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
    this.ctx.scale(this.camera.zoom, this.camera.zoom);
    this.ctx.translate(-this.camera.x, -this.camera.y);
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
    this.clear();
    this.setupCamera();

    // Render all bodies
    bodies.forEach(body => {
      this.ctx.save();

      // Get fill color from render options or use default
      const fillStyle = (body.render as any)?.fillStyle || 
        (body.isStatic ? '#555555' : '#3498db');

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
        this.ctx.beginPath();
        this.ctx.moveTo(vertices[0].x, vertices[0].y);
        for (let i = 1; i < vertices.length; i++) {
          this.ctx.lineTo(vertices[i].x, vertices[i].y);
        }
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();
      }

      this.ctx.restore();
    });

    this.resetCamera();
  }

  /**
   * Update camera position
   */
  setCamera(x: number, y: number, zoom: number = 1): void {
    this.camera = { x, y, zoom };
  }

  /**
   * Clean up
   */
  destroy(): void {
    window.removeEventListener('resize', () => this.resizeCanvas());
  }
}
