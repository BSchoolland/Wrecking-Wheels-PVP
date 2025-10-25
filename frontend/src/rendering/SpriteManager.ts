/**
 * SpriteManager - Handles spritesheet loading and sprite extraction
 * Sprites are organized as: vertical axis = block types, horizontal axis = animation frames
 * Each sprite is 8x8px
 */

export interface SpritesheetConfig {
  name: string;
  url: string;
}

export class SpriteManager {
  private static instance: SpriteManager;
  private loadedSpritesheets: Map<string, HTMLImageElement> = new Map();
  private spriteCache: Map<string, HTMLCanvasElement> = new Map();
  private readonly spriteSize = 8; // 8x8px sprites
  private readonly targetSize = 32; // Scaled to 32x32 in-game

  private constructor() {}

  static getInstance(): SpriteManager {
    if (!SpriteManager.instance) {
      SpriteManager.instance = new SpriteManager();
    }
    return SpriteManager.instance;
  }

  /**
   * Pre-load a spritesheet image. Call this before rendering.
   */
  async loadSpritesheet(name: string, url: string): Promise<void> {
    if (this.loadedSpritesheets.has(name)) {
      return; // Already loaded
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.loadedSpritesheets.set(name, img);
        // Clear cache for this spritesheet to free memory
        this.clearSpriteCacheForSheet(name);
        resolve();
      };
      img.onerror = () => reject(new Error(`Failed to load spritesheet: ${url}`));
      img.src = url;
    });
  }

  /**
   * Check if a spritesheet is loaded
   */
  isSpritesheetLoaded(name: string): boolean {
    return this.loadedSpritesheets.has(name);
  }

  /**
   * Get a sprite from the spritesheet (SYNC - must be called after loadSpritesheet)
   * @param spritesheetName The name of the loaded spritesheet
   * @param spriteRow Which row (0-indexed, represents block type)
   * @param spriteCol Which column (0-indexed, represents animation frame, defaults to 0)
   * @returns Canvas with the extracted sprite (cached for performance)
   */
  getSprite(spritesheetName: string, spriteRow: number, spriteCol: number = 0): HTMLCanvasElement {
    const spritesheet = this.loadedSpritesheets.get(spritesheetName);
    if (!spritesheet) {
      throw new Error(`Spritesheet not loaded: ${spritesheetName}. Call loadSpritesheet() first.`);
    }

    // Check cache first
    const cacheKey = `${spritesheetName}_${spriteRow}_${spriteCol}`;
    if (this.spriteCache.has(cacheKey)) {
      return this.spriteCache.get(cacheKey)!;
    }

    // Extract and cache sprite
    const canvas = document.createElement('canvas');
    canvas.width = this.spriteSize;
    canvas.height = this.spriteSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context for sprite');

    const sourceX = spriteCol * this.spriteSize;
    const sourceY = spriteRow * this.spriteSize;

    ctx.drawImage(
      spritesheet,
      sourceX,
      sourceY,
      this.spriteSize,
      this.spriteSize,
      0,
      0,
      this.spriteSize,
      this.spriteSize
    );

    this.spriteCache.set(cacheKey, canvas);
    return canvas;
  }

  /**
   * Get the scale factor for rendering (sprite size -> target size)
   */
  getScaleFactor(): number {
    return this.targetSize / this.spriteSize;
  }

  /**
   * Clear sprite cache for a specific spritesheet
   */
  private clearSpriteCacheForSheet(sheetName: string): void {
    const keysToDelete: string[] = [];
    this.spriteCache.forEach((_, key) => {
      if (key.startsWith(`${sheetName}_`)) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => this.spriteCache.delete(key));
  }

  /**
   * Clear all sprite caches
   */
  clearAllCaches(): void {
    this.spriteCache.clear();
  }

  /**
   * Pre-load all game spritesheets (call once at startup)
   */
  static async loadSprites(): Promise<void> {
    const manager = SpriteManager.getInstance();
    try {
      await manager.loadSpritesheet('blocks', '/src/assets/blocks-spritesheet.png');
    } catch (error) {
      console.error('Failed to load sprite assets:', error);
      // Game continues without sprites, blocks render as physics bodies
    }
  }
}
