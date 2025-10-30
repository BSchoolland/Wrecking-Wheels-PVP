/**
 * Contraption builder constants
 */

export const BUILDER_CONSTANTS = {
  GRID_SIZE: 32, // Grid cell size in pixels (configurable)
  BLOCK_SIZE: 32, // Standard block size
  
  // Build area sizes (grid cells)
  BUILD_GRID_SIZE: 10, // Current: 10x10 grid
  
  // Constraint settings
  ATTACHMENT_STIFFNESS: 0.7, // Default attachment stiffness (0-1)
  CONSTRAINT_DAMPING: 0.1,
} as const;

