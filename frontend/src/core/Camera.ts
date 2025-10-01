/**
 * Camera System
 * Handles viewport transformation, panning, and coordinate conversion
 */

import { WORLD_BOUNDS } from '@shared/constants/physics';

export interface CameraConfig {
  canvas: HTMLCanvasElement;
  worldWidth?: number;
  worldHeight?: number;
}

export class Camera {
  private canvas: HTMLCanvasElement;
  private worldWidth: number;
  private worldHeight: number;
  
  // Camera state
  public x: number;
  public y: number;
  public zoom: number;

  // Panning state
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragStartCamX = 0;
  private dragStartCamY = 0;

  constructor(config: CameraConfig) {
    this.canvas = config.canvas;
    this.worldWidth = config.worldWidth ?? WORLD_BOUNDS.WIDTH;
    this.worldHeight = config.worldHeight ?? WORLD_BOUNDS.HEIGHT;

    // Start centered with zoom that fits the world
    this.x = this.worldWidth / 2;
    this.y = this.worldHeight / 2;
    this.zoom = this.calculateFitZoom();

    this.setupControls();
  }

  /**
   * Calculate zoom level that fits the entire world in the viewport
   */
  private calculateFitZoom(): number {
    const scaleX = this.canvas.width / this.worldWidth;
    const scaleY = this.canvas.height / this.worldHeight;
    return Math.min(scaleX, scaleY) * 0.95; // 95% to leave some padding
  }

  /**
   * Set up camera controls (panning with mouse drag)
   */
  private setupControls(): void {
    // Mouse down - start dragging
    this.canvas.addEventListener('mousedown', (e) => {
      // Only pan with right click or middle click to avoid interfering with game clicks
      if (e.button === 1 || e.button === 2) {
        e.preventDefault();
        this.isDragging = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.dragStartCamX = this.x;
        this.dragStartCamY = this.y;
        this.canvas.style.cursor = 'grabbing';
      }
    });

    // Mouse move - pan camera
    this.canvas.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;
        
        // Convert screen delta to world delta (accounting for zoom)
        this.x = this.dragStartCamX - dx / this.zoom;
        this.y = this.dragStartCamY - dy / this.zoom;

        // Clamp camera to world bounds (with some padding)
        const padding = 100;
        this.x = Math.max(padding, Math.min(this.worldWidth - padding, this.x));
        this.y = Math.max(padding, Math.min(this.worldHeight - padding, this.y));
      }
    });

    // Mouse up - stop dragging
    const stopDragging = () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.canvas.style.cursor = 'default';
      }
    };
    this.canvas.addEventListener('mouseup', stopDragging);
    this.canvas.addEventListener('mouseleave', stopDragging);

    // Prevent context menu on right click
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    // Optional: Mouse wheel zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      this.zoom = Math.max(0.1, Math.min(3, this.zoom * zoomFactor));
    }, { passive: false });
  }

  /**
   * Convert screen coordinates to world coordinates
   */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const canvasX = screenX - rect.left;
    const canvasY = screenY - rect.top;

    // Apply inverse camera transform
    const worldX = (canvasX - this.canvas.width / 2) / this.zoom + this.x;
    const worldY = (canvasY - this.canvas.height / 2) / this.zoom + this.y;

    return { x: worldX, y: worldY };
  }

  /**
   * Convert world coordinates to screen coordinates
   */
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    const screenX = (worldX - this.x) * this.zoom + this.canvas.width / 2;
    const screenY = (worldY - this.y) * this.zoom + this.canvas.height / 2;

    return { x: screenX, y: screenY };
  }

  /**
   * Apply camera transform to canvas context
   */
  applyTransform(ctx: CanvasRenderingContext2D): void {
    ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  /**
   * Reset to fit entire world in viewport
   */
  resetView(): void {
    this.x = this.worldWidth / 2;
    this.y = this.worldHeight / 2;
    this.zoom = this.calculateFitZoom();
  }

  /**
   * Update camera on window resize
   */
  onResize(): void {
    this.zoom = this.calculateFitZoom();
  }

  /**
   * Clean up event listeners
   */
  destroy(): void {
    // Note: Would need to store bound functions to properly remove listeners
    // For now, this is a placeholder for proper cleanup
  }
}

