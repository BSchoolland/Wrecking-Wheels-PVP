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
  const bodies: Matter.Body[] = [];
  const BLOCK_SIZE = 50;
  
  // Single ground row at y = 450
  const groundY = 450;
  for (let x = BLOCK_SIZE / 2; x < WORLD_BOUNDS.WIDTH; x += BLOCK_SIZE) {
    bodies.push(Matter.Bodies.rectangle(
      x,
      groundY,
      BLOCK_SIZE,
      BLOCK_SIZE,
      { isStatic: true, label: 'ground' }
    ));
  }

  return bodies;
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

