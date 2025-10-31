/**
 * Game design constants
 */

export const GAME_CONSTANTS = {
  // Match settings
  MATCH_DURATION: 300, // 5 minutes in seconds
  STARTING_RESOURCES: 10,
  PASSIVE_RESOURCE_RATE: 1, // resources per second
  
  // Map shrinking (PVP only)
  MAP_SHRINK_START_MS: 10000, // Start destroying ground after 10 seconds
  MAP_SHRINK_DESTROY_INTERVAL_MS: 200, // Destroy one block every 100ms
  MAP_SHRINK_FROM_EDGES: true, // Destroy from both ends toward center
  
  // Contraption limits
  MAX_PARTS_PER_CONTRAPTION: 20,
  MAX_DECK_SIZE: 8,
  
  // Costs (can be overridden per part/contraption)
  MIN_DEPLOYMENT_COST: 1,
  MAX_DEPLOYMENT_COST: 10,
} as const;
