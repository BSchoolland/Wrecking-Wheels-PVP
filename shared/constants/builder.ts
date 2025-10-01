/**
 * Contraption builder constants
 */

export const BUILDER_CONSTANTS = {
  GRID_SIZE: 32, // Grid cell size in pixels (configurable)
  BLOCK_SIZE: 32, // Standard block size
  WHEEL_RADIUS: 12.5, // 25px diameter = 12.5px radius
  WHEEL_ATTACHMENT_HEIGHT: 4, // Attachment face height for wheel
  
  // Constraint settings
  ATTACHMENT_STIFFNESS: 0.7, // Default attachment stiffness (0-1)
  CONSTRAINT_DAMPING: 0.1,
} as const;

