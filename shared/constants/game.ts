/**
 * Game design constants
 */

export const GAME_CONSTANTS = {
  // Match settings
  MATCH_DURATION: 300, // 5 minutes in seconds
  STARTING_RESOURCES: 10,
  PASSIVE_RESOURCE_RATE: 1, // resources per second
  
  // Build Mode
  BUILD_PHASE_SECONDS: 120,
  EXTRA_PARTS_MIN: 5,
  EXTRA_PARTS_MAX: 15,
  // Default weights for randomization (tuned later)
  BUILD_MODE_BLOCK_WEIGHTS: {
    core: 0,       // core is guaranteed separately
    simple: 5,
    wheel: 4,
    spike: 3,
    gray: 3,
    tnt: 1,
    rocket: 2,
    hinge: 2,
  } as const,
  
  // Map shrinking (PVP only)
  MAP_SHRINK_START_MS: 10000, // Start destroying ground after X seconds
  MAP_SHRINK_DESTROY_INTERVAL_MS: 200, // Destroy one block every Y milliseconds
  MAP_SHRINK_FROM_EDGES: true, // Destroy from both ends toward center
  
  // Contraption limits
  MAX_PARTS_PER_CONTRAPTION: 20,
  MAX_DECK_SIZE: 8,
  
  // Costs (can be overridden per part/contraption)
  MIN_DEPLOYMENT_COST: 1,
  MAX_DEPLOYMENT_COST: 10,
} as const;
