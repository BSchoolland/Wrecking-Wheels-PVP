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
  public mirrorX: boolean = false;

  // Panning state
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragStartCamX = 0;
  private dragStartCamY = 0;

  // Bound event handlers for cleanup
  private onMouseDown?: (e: MouseEvent) => void;
  private onMouseMove?: (e: MouseEvent) => void;
  private onMouseUp?: (e: MouseEvent) => void;
  private onMouseLeave?: (e: MouseEvent) => void;
  private onContextMenu?: (e: MouseEvent) => void;
  private onWheel?: (e: WheelEvent) => void;
  private controlsAttached = false;

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
    if (this.controlsAttached) return;
    // Mouse down - start dragging
    this.onMouseDown = (e: MouseEvent) => {
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
    };
    this.canvas.addEventListener('mousedown', this.onMouseDown);

    // Mouse move - pan camera
    this.onMouseMove = (e: MouseEvent) => {
      if (this.isDragging) {
        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;
        
        // Convert screen delta to world delta (accounting for zoom)
        const panDx = this.mirrorX ? -dx : dx;
        this.x = this.dragStartCamX - panDx / this.zoom;
        this.y = this.dragStartCamY - dy / this.zoom;

        // Clamp camera to world bounds (with some padding)
        const padding = 100;
        this.x = Math.max(padding, Math.min(this.worldWidth - padding, this.x));
        this.y = Math.max(padding, Math.min(this.worldHeight - padding, this.y));
      }
    };
    this.canvas.addEventListener('mousemove', this.onMouseMove);

    // Mouse up - stop dragging
    const stopDragging = () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.canvas.style.cursor = 'default';
      }
    };
    this.onMouseUp = stopDragging as (e: MouseEvent) => void;
    this.onMouseLeave = stopDragging as (e: MouseEvent) => void;
    this.canvas.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('mouseleave', this.onMouseLeave);

    // Prevent context menu on right click
    this.onContextMenu = (e: MouseEvent) => { e.preventDefault(); };
    this.canvas.addEventListener('contextmenu', this.onContextMenu);

    // Optional: Mouse wheel zoom
    this.onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      this.zoom = Math.max(0.1, Math.min(3, this.zoom * zoomFactor));
    };
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.controlsAttached = true;
  }

  private detachControls(): void {
    if (!this.controlsAttached) return;
    if (this.onMouseDown) this.canvas.removeEventListener('mousedown', this.onMouseDown);
    if (this.onMouseMove) this.canvas.removeEventListener('mousemove', this.onMouseMove);
    if (this.onMouseUp) this.canvas.removeEventListener('mouseup', this.onMouseUp);
    if (this.onMouseLeave) this.canvas.removeEventListener('mouseleave', this.onMouseLeave);
    if (this.onContextMenu) this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    if (this.onWheel) this.canvas.removeEventListener('wheel', this.onWheel as EventListener);
    this.controlsAttached = false;
    this.isDragging = false;
    this.canvas.style.cursor = 'default';
  }

  public setControlsEnabled(enabled: boolean): void {
    if (enabled) {
      this.setupControls();
    } else {
      this.detachControls();
    }
  }

  /**
   * Convert screen coordinates to world coordinates
   */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const canvasX = screenX - rect.left;
    const canvasY = screenY - rect.top;

    // Apply inverse camera transform
    const dx = (canvasX - this.canvas.width / 2);
    const worldX = ((this.mirrorX ? -dx : dx) / this.zoom) + this.x;
    const worldY = (canvasY - this.canvas.height / 2) / this.zoom + this.y;

    return { x: worldX, y: worldY };
  }

  /**
   * Convert world coordinates to screen coordinates
   */
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    const dx = (worldX - this.x) * this.zoom;
    const screenX = (this.mirrorX ? -dx : dx) + this.canvas.width / 2;
    const screenY = (worldY - this.y) * this.zoom + this.canvas.height / 2;

    return { x: screenX, y: screenY };
  }

  /**
   * Apply camera transform to canvas context
   */
  applyTransform(ctx: CanvasRenderingContext2D): void {
    ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
    ctx.scale(this.zoom, this.zoom);
    if (this.mirrorX) {
      ctx.scale(-1, 1);
    }
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
    this.detachControls();
  }
}

