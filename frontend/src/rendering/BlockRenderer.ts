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
      // Optional per-sprite size (e.g., 16x8 rocket). Default 8x8.
      const size = (body as unknown as { sprite?: { width?: number; height?: number } }).sprite || {};
      const srcW = typeof size.width === 'number' ? size.width : undefined;
      const srcH = typeof size.height === 'number' ? size.height : undefined;

      const currentCol = (body as unknown as { spriteCol?: number }).spriteCol ??
        ((body as unknown as { sprite?: { col?: number } }).sprite?.col ?? 0);
      const spriteCanvas = this.spriteManager.getSprite(spritesheetName, spriteRow, currentCol, srcW, srcH);
      const scale = this.spriteManager.getScaleFactorFor(spriteCanvas.height);
      const flipX = (body as unknown as { sprite?: { flipX?: boolean } }).sprite?.flipX === true;

      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.translate(body.position.x, body.position.y);
      ctx.rotate(body.angle);
      if (flipX) {
        ctx.scale(-1, 1);
      }
      if (offsetX !== 0 || offsetY !== 0) {
        ctx.translate(offsetX, offsetY);
      }
      
      ctx.scale(scale, scale);
      const halfW = spriteCanvas.width / 2;
      const halfH = spriteCanvas.height / 2;
      ctx.drawImage(spriteCanvas, -halfW, -halfH);
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
