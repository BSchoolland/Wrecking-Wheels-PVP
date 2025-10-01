/**
 * Base Block class - all blocks extend this
 */

import Matter from 'matter-js';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';

export type BlockType = 'core' | 'simple' | 'wheel';
export type AttachmentDirection = 'top' | 'right' | 'bottom' | 'left';

export interface BlockData {
  id: string;
  type: BlockType;
  gridX: number;
  gridY: number;
  health: number;
  stiffness: number;
}

export interface PhysicsSpawnResult {
  bodies: Matter.Body[];
  constraints: Matter.Constraint[]; // Internal constraints (e.g., wheel axle)
  primaryBody: Matter.Body; // The main body used for connections
}

export abstract class BaseBlock {
  id: string;
  type: BlockType;
  gridX: number;
  gridY: number;
  health: number;
  stiffness: number;
  
  constructor(id: string, type: BlockType, gridX: number, gridY: number) {
    this.id = id;
    this.type = type;
    this.gridX = gridX;
    this.gridY = gridY;
    this.health = 100;
    this.stiffness = BUILDER_CONSTANTS.ATTACHMENT_STIFFNESS;
  }
  
  /**
   * Get which faces this block can attach to neighbors
   */
  abstract getAttachmentFaces(): AttachmentDirection[];
  
  /**
   * Create physics bodies for this block at the given world position
   */
  abstract createPhysicsBodies(worldX: number, worldY: number): PhysicsSpawnResult;
  
  /**
   * Get the half-height for connection points (allows wheels to have different attachment height)
   */
  protected getConnectionHalfHeight(): number {
    return BUILDER_CONSTANTS.GRID_SIZE / 2;
  }
  
  /**
   * Create constraints to connect this block to a neighbor
   * @param direction Which direction the neighbor is in
   * @param myBody This block's primary body
   * @param neighborBody The neighbor's primary body
   */
  createConnectionConstraints(
    direction: AttachmentDirection,
    myBody: Matter.Body,
    neighborBody: Matter.Body,
    neighbor?: BaseBlock
  ): Matter.Constraint[] {
    const halfSize = BUILDER_CONSTANTS.GRID_SIZE / 2;
    const myHalfHeight = this.getConnectionHalfHeight();
    const neighborHalfHeight = neighbor?.getConnectionHalfHeight() ?? halfSize;
    const constraints: Matter.Constraint[] = [];
    
    if (direction === 'right') {
      // Top corner constraint
      constraints.push(Matter.Constraint.create({
        bodyA: myBody,
        bodyB: neighborBody,
        pointA: { x: halfSize, y: -halfSize },
        pointB: { x: -halfSize, y: -halfSize },
        length: 0,
        stiffness: this.stiffness,
        damping: BUILDER_CONSTANTS.CONSTRAINT_DAMPING,
      }));
      
      // Bottom corner constraint
      constraints.push(Matter.Constraint.create({
        bodyA: myBody,
        bodyB: neighborBody,
        pointA: { x: halfSize, y: halfSize },
        pointB: { x: -halfSize, y: halfSize },
        length: 0,
        stiffness: this.stiffness,
        damping: BUILDER_CONSTANTS.CONSTRAINT_DAMPING,
      }));
    } else if (direction === 'bottom') {
      // Left corner constraint
      constraints.push(Matter.Constraint.create({
        bodyA: myBody,
        bodyB: neighborBody,
        pointA: { x: -halfSize, y: myHalfHeight },
        pointB: { x: -halfSize, y: -neighborHalfHeight },
        length: 0,
        stiffness: this.stiffness,
        damping: BUILDER_CONSTANTS.CONSTRAINT_DAMPING,
      }));
      
      // Right corner constraint
      constraints.push(Matter.Constraint.create({
        bodyA: myBody,
        bodyB: neighborBody,
        pointA: { x: halfSize, y: myHalfHeight },
        pointB: { x: halfSize, y: -neighborHalfHeight },
        length: 0,
        stiffness: this.stiffness,
        damping: BUILDER_CONSTANTS.CONSTRAINT_DAMPING,
      }));
    }
    
    return constraints;
  }
  
  /**
   * Serialize block to data for saving
   */
  toData(): BlockData {
    return {
      id: this.id,
      type: this.type,
      gridX: this.gridX,
      gridY: this.gridY,
      health: this.health,
      stiffness: this.stiffness,
    };
  }
}

