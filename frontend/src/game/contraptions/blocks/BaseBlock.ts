/**
 * Base Block class - all blocks extend this
 */

import Matter from 'matter-js';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';

export type BlockType = 'core' | 'simple' | 'wheel' | 'spike';
export type AttachmentDirection = 'top' | 'right' | 'bottom' | 'left';

export interface BlockData {
  id: string;
  type: BlockType;
  gridX: number;
  gridY: number;
  health: number;
  stiffness: number;
  damage?: number;
  knockback?: number;
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
  damage: number; // damage dealt on contact
  knockback: number; // force magnitude applied on contact
  
  constructor(id: string, type: BlockType, gridX: number, gridY: number) {
    this.id = id;
    this.type = type;
    this.gridX = gridX;
    this.gridY = gridY;
    this.health = 100;
    this.stiffness = BUILDER_CONSTANTS.ATTACHMENT_STIFFNESS;
    this.damage = 2;
    this.knockback = 0.01;
  }
  
  /**
   * Get which faces this block can attach to neighbors
   */
  abstract getAttachmentFaces(): AttachmentDirection[];
  
  /**
   * Create physics bodies for this block at the given world position
   */
  abstract createPhysicsBodies(worldX: number, worldY: number, direction?: number): PhysicsSpawnResult;

  /**
   * Default collision behavior: damage the other block if from a different contraption
   * and apply a brief separating knockback force to both bodies.
   */
  onCollision(myBody: Matter.Body, otherBody: Matter.Body): void {
    const targetBlock = (otherBody as unknown as { block?: BaseBlock }).block;
    const myContraptionId = (myBody as unknown as { contraptionId?: string }).contraptionId;
    const targetContraptionId = (otherBody as unknown as { contraptionId?: string }).contraptionId;
    
    if (targetBlock && myContraptionId !== targetContraptionId) {
      // Apply damage scaled by attacker's linear speed
      const speed = Math.hypot(myBody.velocity.x, myBody.velocity.y);
      const damageAmount = this.damage * speed;
      targetBlock.health -= damageAmount;

      // Compute normalized separation vector from myBody to otherBody
      const dx = otherBody.position.x - myBody.position.x;
      const dy = otherBody.position.y - myBody.position.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len;
      const ny = dy / len;

      // Use tunable knockback magnitude
      const fx = nx * this.knockback;
      const fy = ny * this.knockback;

      // Ensure bodies are awake so forces take effect immediately
      Matter.Sleeping.set(myBody, false);
      Matter.Sleeping.set(otherBody, false);

      const myPhysics = (myBody as unknown as { physics?: { queueForce: (b: Matter.Body, f: Matter.Vector) => void } }).physics;
      const otherPhysics = (otherBody as unknown as { physics?: { queueForce: (b: Matter.Body, f: Matter.Vector) => void } }).physics;
      if (myPhysics && otherPhysics) {
        myPhysics.queueForce(myBody, { x: -fx, y: -fy });
        otherPhysics.queueForce(otherBody, { x: fx, y: fy });
      } else {
        Matter.Body.applyForce(myBody, myBody.position, { x: -fx, y: -fy });
        Matter.Body.applyForce(otherBody, otherBody.position, { x: fx, y: fy });
      }
    }
  }
  
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
   * @param neighbor The neighbor block
   * @param facingDirection The direction the contraption is facing (1 or -1)
   */
  createConnectionConstraints(
    direction: AttachmentDirection,
    myBody: Matter.Body,
    neighborBody: Matter.Body,
    neighbor?: BaseBlock,
    facingDirection: number = 1
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
        pointA: { x: halfSize * facingDirection, y: -halfSize },
        pointB: { x: -halfSize * facingDirection, y: -halfSize },
        length: 0,
        stiffness: this.stiffness,
        damping: BUILDER_CONSTANTS.CONSTRAINT_DAMPING,
      }));
      
      // Bottom corner constraint
      constraints.push(Matter.Constraint.create({
        bodyA: myBody,
        bodyB: neighborBody,
        pointA: { x: halfSize * facingDirection, y: halfSize },
        pointB: { x: -halfSize * facingDirection, y: halfSize },
        length: 0,
        stiffness: this.stiffness,
        damping: BUILDER_CONSTANTS.CONSTRAINT_DAMPING,
      }));
    } else if (direction === 'bottom') {
      // Left corner constraint
      constraints.push(Matter.Constraint.create({
        bodyA: myBody,
        bodyB: neighborBody,
        pointA: { x: -halfSize * facingDirection, y: myHalfHeight },
        pointB: { x: -halfSize * facingDirection, y: -neighborHalfHeight },
        length: 0,
        stiffness: this.stiffness,
        damping: BUILDER_CONSTANTS.CONSTRAINT_DAMPING,
      }));
      
      // Right corner constraint
      constraints.push(Matter.Constraint.create({
        bodyA: myBody,
        bodyB: neighborBody,
        pointA: { x: halfSize * facingDirection, y: myHalfHeight },
        pointB: { x: halfSize * facingDirection, y: -neighborHalfHeight },
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
      damage: this.damage,
      knockback: this.knockback,
    };
  }
}

