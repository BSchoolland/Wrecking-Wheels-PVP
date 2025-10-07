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
  
  // Lower ground - create many small blocks instead of one large one
  const lowerY = WORLD_BOUNDS.HEIGHT + 25;
  for (let x = BLOCK_SIZE / 2; x < WORLD_BOUNDS.WIDTH; x += BLOCK_SIZE) {
    bodies.push(Matter.Bodies.rectangle(
      x,
      lowerY,
      BLOCK_SIZE,
      BLOCK_SIZE,
      { isStatic: true, label: 'ground-lower' }
    ));
  }

  // Upper ground - create many small blocks instead of one large one
  const upperY = 0;
  for (let x = BLOCK_SIZE / 2; x < WORLD_BOUNDS.WIDTH; x += BLOCK_SIZE) {
    bodies.push(Matter.Bodies.rectangle(
      x,
      upperY,
      BLOCK_SIZE,
      BLOCK_SIZE,
      { isStatic: true, label: 'ground-upper' }
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

