/**
 * Game design constants
 */

export const GAME_CONSTANTS = {
  // Match settings
  MATCH_DURATION: 300, // 5 minutes in seconds
  STARTING_RESOURCES: 10,
  PASSIVE_RESOURCE_RATE: 1, // resources per second
  
  // Contraption limits
  MAX_PARTS_PER_CONTRAPTION: 20,
  MAX_DECK_SIZE: 8,
  
  // Costs (can be overridden per part/contraption)
  MIN_DEPLOYMENT_COST: 1,
  MAX_DEPLOYMENT_COST: 10,
} as const;
