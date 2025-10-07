/**
 * Map/Terrain loading utilities
 */

import Matter from 'matter-js';
import { WORLD_BOUNDS } from '@shared/constants/physics';

/**
 * Create the standard map boundaries (ground + walls)
 * This is called by PhysicsEngine constructor automatically
 */
export function createMapBoundaries(): Matter.Body[] {
  // Lower ground
  const groundLower = Matter.Bodies.rectangle(
    WORLD_BOUNDS.WIDTH / 2,
    WORLD_BOUNDS.HEIGHT + 25,
    WORLD_BOUNDS.WIDTH,
    50,
    { isStatic: true, label: 'ground-lower' }
  );

  // Upper ground (second layer)
  const groundUpper = Matter.Bodies.rectangle(
    WORLD_BOUNDS.WIDTH / 2,
    0,
    WORLD_BOUNDS.WIDTH,
    50,
    { isStatic: true, label: 'ground-upper' }
  );

  return [groundLower, groundUpper];
}

/**
 * Get spawn position for testing contraptions
 */
export function getTestSpawnPosition(): { x: number, y: number } {
  return {
    x: WORLD_BOUNDS.WIDTH / 2,
    y: WORLD_BOUNDS.HEIGHT / 2,
  };
}

