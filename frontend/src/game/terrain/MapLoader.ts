/**
 * Map/Terrain loading utilities
 */

import Matter from 'matter-js';
import { WORLD_BOUNDS } from '@shared/constants/physics';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';

// Ground constants
export const GROUND_BLOCK_SIZE = 50;
export const GROUND_CENTER_Y = 450;
export const GROUND_TOP_Y = GROUND_CENTER_Y - GROUND_BLOCK_SIZE / 2; // 425

// Map block constants
export const MAP_BLOCK_SIZE = GROUND_BLOCK_SIZE; // Same as ground blocks
export const MAP_START_Y = GROUND_TOP_Y; // Start at same position as original ground top

// Map configurations
interface MapConfig {
  blockSize: number;
  startY: number;
  rowCount: number;
}

const MAP_CONFIGS: Record<string, MapConfig> = {
  default: {
    blockSize: MAP_BLOCK_SIZE,
    startY: MAP_START_Y,
    rowCount: 4
  },
};

// Brown shades for map blocks
const BROWN_SHADES = [
  '#8B7355', // Standard brown
  '#A0826D', // Lighter brown
  '#6B5344', // Darker brown
  '#9B8B75', // Sandy brown
  '#7B6B55', // Deep brown
  '#8B7765', // Warm brown
];

// Green shades for grass blocks
const GREEN_SHADES = [
  '#228B22', // Forest green
  '#32CD32', // Lime green
  '#3CB371', // Medium sea green
  '#2E8B57', // Sea green
  '#6B8E23', // Olive drab
  '#556B2F', // Dark olive green
];

// Determine grass depth for a given column (1-3 blocks)
function getGrassDepthForColumn(col: number): number {
  return (Math.abs(col) % 3) + 1; // 1-3 blocks
}

// Get a random color (green for grass, brown for dirt)
function getBlockColor(col: number, row: number, isGrass: boolean): string {
  const seed = col + row * 1000;
  const index = Math.abs(seed) % (isGrass ? GREEN_SHADES.length : BROWN_SHADES.length);
  return isGrass ? GREEN_SHADES[index] : BROWN_SHADES[index];
}

/**
 * Load a map with 2x smaller blocks that fill downwards
 * @param mapName - The map to load (default: "default")
 * @returns Array of physics bodies for the map
 */
export function loadMap(mapName: string = 'default'): Matter.Body[] {
  const config = MAP_CONFIGS[mapName] || MAP_CONFIGS.default;
  const bodies: Matter.Body[] = [];
  
  // Fill horizontally and vertically with smaller blocks
  let col = 0;
  for (let x = config.blockSize / 2; x < WORLD_BOUNDS.WIDTH; x += config.blockSize) {
    for (let row = 0; row < config.rowCount; row++) {
      const y = config.startY + (row * config.blockSize) + config.blockSize / 2;
      const grassDepth = getGrassDepthForColumn(col);
      const isGrass = row < grassDepth;
      
      bodies.push(Matter.Bodies.rectangle(
        x,
        y,
        config.blockSize,
        config.blockSize,
        { 
          isStatic: true, 
          label: 'ground',
          render: { fillStyle: getBlockColor(col, row, isGrass) }
        }
      ));
    }
    col++;
  }

  return bodies;
}

/**
 * Create the standard map boundaries (ground + walls)
 * This is called by PhysicsEngine constructor automatically
 */
export function createMapBoundaries(): Matter.Body[] {
  return loadMap('default');
}

/**
 * Get spawn position for testing contraptions
 * Positions contraption so its bottom aligns with the top of the ground
 */
export function getTestSpawnPosition(): { x: number, y: number } {
  // Calculate spawn Y so bottom of 10x10 grid aligns with ground top
  // Grid goes from -5 to 4, so bottom cell is at gridY=4
  // Bottom of that cell is at spawnY + 4.5 * GRID_SIZE
  const gridHalfSize = BUILDER_CONSTANTS.BUILD_GRID_SIZE / 2;
  const bottomOffset = (gridHalfSize - 0.5) * BUILDER_CONSTANTS.GRID_SIZE;
  const spawnY = GROUND_TOP_Y - bottomOffset;
  
  return {
    x: WORLD_BOUNDS.WIDTH / 2,
    y: spawnY,
  };
}

