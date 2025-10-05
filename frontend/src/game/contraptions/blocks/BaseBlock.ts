/**
 * Base Block class - all blocks extend this
 */

import Matter from 'matter-js';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';

export type BlockType = 'core' | 'simple' | 'wheel' | 'spike' | 'gray' | 'tnt';
export type AttachmentDirection = 'top' | 'right' | 'bottom' | 'left';
export type DamageType = 'sharp' | 'blunt' | 'blast';

interface EffectsInterface {
  spawnImpactParticles: (x: number, y: number, damage: number, vx: number, vy: number) => void;
  spawnDamageNumber: (x: number, y: number, damage: number) => void;
  applyBlockTint: (id: number, damage: number) => void;
}

export interface BlockData {
  id: string;
  type: BlockType;
  gridX: number;
  gridY: number;
  health: number;
  maxHealth: number;
  stiffness: number;
  damage?: number;
  knockback?: number;
  fragile?: boolean;
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
  maxHealth: number;
  stiffness: number;
  damage: number; // damage dealt on contact
  knockback: number; // force magnitude applied on contact
  fragile: boolean;
  
  constructor(id: string, type: BlockType, gridX: number, gridY: number, maxHealth: number = 100) {
    this.id = id;
    this.type = type;
    this.gridX = gridX;
    this.gridY = gridY;
    this.maxHealth = maxHealth;
    this.health = maxHealth;
    this.stiffness = BUILDER_CONSTANTS.ATTACHMENT_STIFFNESS;
    this.damage = 2;
    this.knockback = 0.01;
    this.fragile = false;
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
   * Default collision behavior: damage the other block if from a different team
   * and apply a brief separating knockback force to both bodies.
   * Accepts a damageType for resistance logic. Use 'sharp' for spikes, 'blunt' for block collisions.
   */
  onCollision(myBody: Matter.Body, otherBody: Matter.Body, damageType: DamageType = 'blunt'): void {
    const targetBlock = (otherBody as unknown as { block?: BaseBlock }).block;
    const myContraptionId = (myBody as unknown as { contraptionId?: string }).contraptionId;
    const targetContraptionId = (otherBody as unknown as { contraptionId?: string }).contraptionId;
    const myTeam = (myBody as unknown as { team?: string }).team;
    const targetTeam = (otherBody as unknown as { team?: string }).team;
    
    const isFriendly = targetBlock && myContraptionId && targetContraptionId && myTeam && targetTeam && 
      (myContraptionId === targetContraptionId || myTeam === targetTeam);
    
    if (isFriendly) {
      return;
    }
    
    const relativeSpeed = Math.hypot(
      myBody.velocity.x - otherBody.velocity.x,
      myBody.velocity.y - otherBody.velocity.y
    );
    
    if (this.fragile) {
      const isTerrain = otherBody.label && (otherBody.label === 'ground' || otherBody.label.includes('wall'));
      let damageAmount = relativeSpeed * 2;
      if (isTerrain) {
        damageAmount += 1;
      }
      if (damageAmount > 0.5) {
        this.health -= damageAmount;
        const effects = (myBody as unknown as { effects?: EffectsInterface }).effects;
        if (effects) {
          const impactX = (myBody.position.x + otherBody.position.x) / 2;
          const impactY = (myBody.position.y + otherBody.position.y) / 2;
          effects.spawnImpactParticles(impactX, impactY, damageAmount, myBody.velocity.x, myBody.velocity.y);
          effects.spawnDamageNumber(myBody.position.x, myBody.position.y - 15, damageAmount);
          effects.applyBlockTint(myBody.id, damageAmount);
        }
      }
    }
    
    // Only damage if from different contraption AND different team (no friendly fire)
    if (!this.fragile && targetBlock && myContraptionId !== targetContraptionId && myTeam !== targetTeam) {
      // Apply damage scaled by attacker's linear speed
      const speed = Math.hypot(myBody.velocity.x, myBody.velocity.y);
      let damageAmount = this.damage * speed;
      // Resistance logic will be handled in subclasses
      if (typeof targetBlock.applyResistance === 'function') {
        damageAmount = targetBlock.applyResistance(damageAmount, damageType);
      }
      targetBlock.health -= damageAmount;

      // Spawn visual effects
      const effects = (myBody as unknown as { effects?: EffectsInterface }).effects;
      if (effects && damageAmount > 0.5) { // Only show effects for meaningful damage
        // Impact point (midpoint between bodies)
        const impactX = (myBody.position.x + otherBody.position.x) / 2;
        const impactY = (myBody.position.y + otherBody.position.y) / 2;
        
        // Spawn impact particles
        effects.spawnImpactParticles(impactX, impactY, damageAmount, myBody.velocity.x, myBody.velocity.y);
        
        // Spawn damage number
        effects.spawnDamageNumber(otherBody.position.x, otherBody.position.y - 15, damageAmount);
        
        // Apply red tint to damaged block
        effects.applyBlockTint(otherBody.id, damageAmount);
      }
    }

    const isTerrain = otherBody.label && (otherBody.label === 'ground' || otherBody.label.includes('wall'));
    if (isTerrain && !this.fragile) {
      return; // No knockback for non-fragile blocks hitting terrain
    }

    // Compute normalized separation vector from myBody to otherBody
    const dx = otherBody.position.x - myBody.position.x;
    const dy = otherBody.position.y - myBody.position.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;

    // Use tunable knockback magnitude
    const fx = nx * this.knockback;
    const fy = ny * this.knockback;

    // // Amplify knockback 100x for fragile blocks hitting terrain
    // if (this.fragile && otherBody.label && (otherBody.label === 'ground' || otherBody.label.includes('wall'))) {
    //   console.log('Fragile terrain collision detected:', otherBody.label, 'nx:', nx, 'ny:', ny, 'base fx/fy:', fx, fy);
    //   fx *= 1000000;
    //   fy *= 1000000;
    //   console.log('After amplification fx/fy:', fx, fy);
    // }

    // Ensure bodies are awake so forces take effect immediately
    Matter.Sleeping.set(myBody, false);
    Matter.Sleeping.set(otherBody, false);

    const myPhysics = (myBody as unknown as { physics?: { queueForce: (b: Matter.Body, f: Matter.Vector) => void } }).physics;
    const otherPhysics = (otherBody as unknown as { physics?: { queueForce: (b: Matter.Body, f: Matter.Vector) => void } }).physics;
    if (myPhysics && otherPhysics) {
      myPhysics.queueForce(myBody, { x: -fx, y: -fy });
      otherPhysics.queueForce(otherBody, { x: fx, y: fy });
    } else if (myPhysics) {
      myPhysics.queueForce(myBody, { x: -fx, y: -fy });
    }
  }

  // Optional: Override in subclasses for resistance
  applyResistance?(amount: number, type: DamageType): number;
  
  /**
   * Get the half-height for connection points (allows wheels to have different attachment height)
   */
  protected getConnectionHalfHeight(): number {
    return BUILDER_CONSTANTS.GRID_SIZE / 2;
  }
  
  /**
   * Get local attachment points for a given face
   * Override in subclasses for non-rectangular shapes or offset bodies
   */
  protected getAttachmentPoints(face: AttachmentDirection, facingDirection: number): { pointA: Matter.Vector, pointB: Matter.Vector } {
    const halfSize = BUILDER_CONSTANTS.GRID_SIZE / 2;
    const myHalfHeight = this.getConnectionHalfHeight();
    
    if (face === 'right') {
      return {
        pointA: { x: halfSize * facingDirection, y: -halfSize },
        pointB: { x: halfSize * facingDirection, y: halfSize }
      };
    } else if (face === 'bottom') {
      return {
        pointA: { x: -halfSize * facingDirection, y: myHalfHeight },
        pointB: { x: halfSize * facingDirection, y: myHalfHeight }
      };
    } else if (face === 'left') {
      return {
        pointA: { x: -halfSize * facingDirection, y: -halfSize },
        pointB: { x: -halfSize * facingDirection, y: halfSize }
      };
    } else { // top
      return {
        pointA: { x: -halfSize * facingDirection, y: -myHalfHeight },
        pointB: { x: halfSize * facingDirection, y: -myHalfHeight }
      };
    }
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
    const constraints: Matter.Constraint[] = [];
    
    // Get attachment points for this block and neighbor
    const myPoints = this.getAttachmentPoints(direction, facingDirection);
    
    // Determine opposite face for neighbor
    const oppositeFace: Record<AttachmentDirection, AttachmentDirection> = {
      'top': 'bottom',
      'right': 'left',
      'bottom': 'top',
      'left': 'right'
    };
    const neighborPoints = neighbor?.getAttachmentPoints(oppositeFace[direction], facingDirection) ?? myPoints;
    
    // Create two corner constraints
    constraints.push(Matter.Constraint.create({
      bodyA: myBody,
      bodyB: neighborBody,
      pointA: myPoints.pointA,
      pointB: neighborPoints.pointA,
      length: 0,
      stiffness: this.stiffness,
      damping: BUILDER_CONSTANTS.CONSTRAINT_DAMPING,
    }));
    
    constraints.push(Matter.Constraint.create({
      bodyA: myBody,
      bodyB: neighborBody,
      pointA: myPoints.pointB,
      pointB: neighborPoints.pointB,
      length: 0,
      stiffness: this.stiffness,
      damping: BUILDER_CONSTANTS.CONSTRAINT_DAMPING,
    }));
    
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
      maxHealth: this.maxHealth,
      stiffness: this.stiffness,
      damage: this.damage,
      knockback: this.knockback,
      fragile: this.fragile,
    };
  }
}

