/**
 * Physics constants for Matter.js simulation
 * These values are shared to ensure consistency
 */

export const PHYSICS_CONSTANTS = {
  // Time
  FIXED_TIMESTEP: 1000 / 60, // 60 FPS in milliseconds
  TICK_RATE: 60, // Simulation ticks per second
  
  // World
  GRAVITY: 1.0, // Gravity strength
  
  // Network
  STATE_SYNC_RATE: 20, // Send state updates 20 times per second
  INTERPOLATION_DELAY: 100, // ms - client renders slightly in the past for smooth interpolation
  
  // Gameplay
  DEPLOYMENT_BUILD_TIME: 1000, // ms - how long it takes to construct a contraption
} as const;

export const WORLD_BOUNDS = {
  WIDTH: 2000,
  HEIGHT: 800,
} as const;
