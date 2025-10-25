/**
 * BlockRenderer - Renders blocks using sprite data
 * Simple sprite rendering without needing full block objects
 */

import Matter from 'matter-js';
import { SpriteManager } from './SpriteManager';

export class BlockRenderer {
  private static spriteManager = SpriteManager.getInstance();

  /**
   * Render a sprite (main rendering method)
   */
  static renderSprite(
    ctx: CanvasRenderingContext2D,
    body: Matter.Body,
    spritesheetName: string,
    spriteRow: number,
    offsetX: number = 0,
    offsetY: number = 0
  ): void {
    if (!this.spriteManager.isSpritesheetLoaded(spritesheetName)) {
      this.renderPhysicsBody(ctx, body);
      return;
    }

    try {
      const spriteCanvas = this.spriteManager.getSprite(spritesheetName, spriteRow, 0);
      const scale = this.spriteManager.getScaleFactor();

      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.translate(body.position.x, body.position.y);
      ctx.rotate(body.angle);
      
      if (offsetX !== 0 || offsetY !== 0) {
        ctx.translate(offsetX, offsetY);
      }
      
      ctx.scale(scale, scale);
      ctx.drawImage(spriteCanvas, -4, -4);
      ctx.restore();
    } catch (error) {
      console.warn(`Failed to render sprite:`, error);
      this.renderPhysicsBody(ctx, body);
    }
  }

  /**
   * Render a physics body as fallback (when no sprite available)
   */
  static renderPhysicsBody(ctx: CanvasRenderingContext2D, body: Matter.Body): void {
    ctx.save();

    const bodyRender = body.render as { fillStyle?: string; strokeStyle?: string; lineWidth?: number };
    const fill = bodyRender?.fillStyle || '#888';
    const stroke = bodyRender?.strokeStyle || '#000';
    const lineWidth = bodyRender?.lineWidth ?? 2;

    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;

    // Handle circle bodies
    const bodyWithCircle = body as Matter.Body & { circleRadius?: number };
    if (bodyWithCircle.circleRadius) {
      const r = bodyWithCircle.circleRadius;
      ctx.beginPath();
      ctx.arc(body.position.x, body.position.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (body.vertices && body.vertices.length) {
      // Handle polygon bodies
      ctx.beginPath();
      ctx.moveTo(body.vertices[0].x, body.vertices[0].y);
      for (let i = 1; i < body.vertices.length; i++) {
        ctx.lineTo(body.vertices[i].x, body.vertices[i].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }
}
