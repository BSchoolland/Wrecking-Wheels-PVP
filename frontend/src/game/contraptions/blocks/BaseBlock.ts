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
  materialCost?: number;
  energyCost?: number;
  rotation?: number;
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
  materialCost: number;
  energyCost: number;
  rotation: number;
  ignoreRotation: boolean;
  
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
    this.materialCost = 0;
    this.energyCost = 0;
    this.rotation = 0;
    this.ignoreRotation = false;
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

    const isBase = otherBody.label && otherBody.label.includes('base');
    const isTerrain = otherBody.label && (otherBody.label === 'ground' || otherBody.label.includes('wall'));
    if (isBase || (isTerrain && !this.fragile)) {
      return; // No knockback for bases or non-fragile blocks hitting terrain
    }
    
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

  protected getRotationSteps(): number {
    const step = Math.PI / 2;
    const twoPi = Math.PI * 2;
    const r = ((this.rotation % twoPi) + twoPi) % twoPi;
    return Math.round(r / step) % 4;
  }

  getRotatedAttachmentFaces(): AttachmentDirection[] {
    if (this.ignoreRotation) return this.getAttachmentFaces();
    const steps = this.getRotationSteps();
    if (steps === 0) return this.getAttachmentFaces();
    const order: AttachmentDirection[] = ['top', 'right', 'bottom', 'left'];
    return this.getAttachmentFaces().map(f => order[(order.indexOf(f) + steps + 4) % 4]);
  }

  private inverseRotateDirection(dir: AttachmentDirection, steps: number): AttachmentDirection {
    const order: AttachmentDirection[] = ['top', 'right', 'bottom', 'left'];
    return order[(order.indexOf(dir) - steps + 400) % 4];
  }
  
  protected rotatePointBySteps(point: Matter.Vector, steps: number): Matter.Vector {
    const s = ((steps % 4) + 4) % 4;
    if (s === 0) return { x: point.x, y: point.y };
    if (s === 1) return { x: -point.y, y: point.x };
    if (s === 2) return { x: -point.x, y: -point.y };
    return { x: point.y, y: -point.x }; // s === 3
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
    
    // Determine each block's local faces accounting for rotation
    const mySteps = this.ignoreRotation ? 0 : this.getRotationSteps();
    const oppositeFace: Record<AttachmentDirection, AttachmentDirection> = {
      'top': 'bottom',
      'right': 'left',
      'bottom': 'top',
      'left': 'right'
    };
    const neighborSteps = neighbor && !neighbor.ignoreRotation ? neighbor.getRotationSteps() : 0;

    const myLocalFace = this.inverseRotateDirection(direction, mySteps);
    const neighborWorldFace = oppositeFace[direction];
    const neighborLocalFace = neighbor ? neighbor.inverseRotateDirection(neighborWorldFace, neighborSteps) : neighborWorldFace;

    const myPoints = this.getAttachmentPoints(myLocalFace, facingDirection);
    const neighborPoints = neighbor?.getAttachmentPoints(neighborLocalFace, facingDirection) ?? myPoints;
    
    // Rotate points by each block's rotation steps
    let myA = this.rotatePointBySteps(myPoints.pointA, mySteps);
    let myB = this.rotatePointBySteps(myPoints.pointB, mySteps);
    let neighborA = neighbor ? neighbor.rotatePointBySteps(neighborPoints.pointA, neighborSteps) : this.rotatePointBySteps(neighborPoints.pointA, neighborSteps);
    let neighborB = neighbor ? neighbor.rotatePointBySteps(neighborPoints.pointB, neighborSteps) : this.rotatePointBySteps(neighborPoints.pointB, neighborSteps);

    // If mirrored, flip local Y based on the starting face orientation:
    // - For vertical faces (left/right), flip on odd steps (1 or 3)
    // - For horizontal faces (top/bottom), flip only on step 2
    const myFaceIsVertical = (myLocalFace === 'left' || myLocalFace === 'right');
    const neighborFaceIsVertical = (neighborLocalFace === 'left' || neighborLocalFace === 'right');
    if (facingDirection === -1) {
      const shouldFlipMy = myFaceIsVertical ? (mySteps % 2 === 1) : (mySteps % 4 === 2);
      if (shouldFlipMy) {
        myA = { x: myA.x, y: -myA.y };
        myB = { x: myB.x, y: -myB.y };
      }
      const shouldFlipNeighbor = neighborFaceIsVertical ? (neighborSteps % 2 === 1) : (neighborSteps % 4 === 2);
      if (shouldFlipNeighbor) {
        neighborA = { x: neighborA.x, y: -neighborA.y };
        neighborB = { x: neighborB.x, y: -neighborB.y };
      }
    }

    // Swap endpoints to keep consistent end mapping.
    // Vertical faces (left/right): swap on steps 1 and 2
    // Horizontal faces (top/bottom): swap on steps 2 and 3
    const baseSwapMy = (mySteps === 2) || (myFaceIsVertical && mySteps === 1) || (!myFaceIsVertical && mySteps === 3);
    const baseSwapNeighbor = (neighborSteps === 2) || (neighborFaceIsVertical && neighborSteps === 1) || (!neighborFaceIsVertical && neighborSteps === 3);
    const invertMy = (facingDirection === -1) && (mySteps % 2 === 1);
    const invertNeighbor = (facingDirection === -1) && (neighborSteps % 2 === 1);
    const doSwapMy = invertMy ? !baseSwapMy : baseSwapMy;
    const doSwapNeighbor = invertNeighbor ? !baseSwapNeighbor : baseSwapNeighbor;
    const [finalMyA, finalMyB] = doSwapMy ? [myB, myA] : [myA, myB];
    const [finalNeighborA, finalNeighborB] = doSwapNeighbor ? [neighborB, neighborA] : [neighborA, neighborB];
    
    constraints.push(Matter.Constraint.create({
      bodyA: myBody,
      bodyB: neighborBody,
      pointA: finalMyA,
      pointB: finalNeighborA,
      length: 0,
      stiffness: this.stiffness,
      damping: BUILDER_CONSTANTS.CONSTRAINT_DAMPING,
    }));
    
    constraints.push(Matter.Constraint.create({
      bodyA: myBody,
      bodyB: neighborBody,
      pointA: finalMyB,
      pointB: finalNeighborB,
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
      materialCost: this.materialCost,
      energyCost: this.energyCost,
      rotation: this.rotation,
    };
  }
}

