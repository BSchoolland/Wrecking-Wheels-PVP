/**
 * Physics Engine - Wrapper around Matter.js
 * Runs ONLY on the host machine
 */

import Matter from 'matter-js';
import { PHYSICS_CONSTANTS } from '@shared/constants/physics';
import type { PhysicsBodyState, Vector2D } from '@shared/types/GameState';
import { createMapBoundaries } from '@/game/terrain/MapLoader';
import type { BaseBlock } from '@/game/contraptions/blocks/BaseBlock';

interface ContraptionLike {
  id: string;
  checkConnectivity?: () => void;
}

export class PhysicsEngine {
  private engine: Matter.Engine;
  private world: Matter.World;
  private runner: Matter.Runner | null = null;
  private bodiesToRemove: Set<Matter.Body> = new Set();
  private constraintsToRemove: Set<Matter.Constraint> = new Set();
  private pendingForces: Map<number, { x: number, y: number }> = new Map();
  private contraptions: Map<string, ContraptionLike> = new Map();

  constructor() {
    // Create Matter.js engine
    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: PHYSICS_CONSTANTS.GRAVITY, scale: 0.001 },
    });
    this.world = this.engine.world;

    // Create world boundaries
    this.createBoundaries();
    
    // Set up collision detection
    this.setupCollisionHandling();
  }

  private createBoundaries(): void {
    const boundaries = createMapBoundaries();
    Matter.World.add(this.world, boundaries);
  }

  private setupCollisionHandling(): void {
    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      event.pairs.forEach(pair => {
        const bodyA = pair.bodyA;
        const bodyB = pair.bodyB;
        
        // Call onCollision callback if body has one
        const onCollisionA = (bodyA as unknown as { onCollision?: (myBody: Matter.Body, otherBody: Matter.Body) => void }).onCollision;
        const onCollisionB = (bodyB as unknown as { onCollision?: (myBody: Matter.Body, otherBody: Matter.Body) => void }).onCollision;
        
        if (onCollisionA) onCollisionA(bodyA, bodyB);
        if (onCollisionB) onCollisionB(bodyB, bodyA);
      });
    });
  }

  private cleanupDeadBlocks(): void {
    const allBodies = Matter.Composite.allBodies(this.world);
    const allConstraints = Matter.Composite.allConstraints(this.world);
    const affectedContraptions = new Set<string>();
    
    // Find blocks with 0 health
    allBodies.forEach(body => {
      const block = (body as unknown as { block?: BaseBlock }).block;
      if (block && block.health <= 0) {
        this.bodiesToRemove.add(body);
        const contraptionId = (body as unknown as { contraptionId?: string }).contraptionId;
        if (contraptionId) affectedContraptions.add(contraptionId);
      }
    });
    
    // Remove constraints connected to dead bodies
    allConstraints.forEach(constraint => {
      if (constraint.bodyA && this.bodiesToRemove.has(constraint.bodyA)) {
        this.constraintsToRemove.add(constraint);
      }
      if (constraint.bodyB && this.bodiesToRemove.has(constraint.bodyB)) {
        this.constraintsToRemove.add(constraint);
      }
    });
    
    // Remove from world
    if (this.bodiesToRemove.size > 0) {
      Matter.World.remove(this.world, Array.from(this.bodiesToRemove));
      this.bodiesToRemove.clear();
    }
    if (this.constraintsToRemove.size > 0) {
      Matter.World.remove(this.world, Array.from(this.constraintsToRemove) as unknown as Matter.Body);
      this.constraintsToRemove.clear();
    }
    
    // Check connectivity for affected contraptions
    affectedContraptions.forEach(id => {
      const contraption = this.contraptions.get(id);
      if (contraption?.checkConnectivity) {
        contraption.checkConnectivity();
      }
    });
  }

  /**
   * Start the physics simulation with fixed timestep
   */
  start(): void {
    this.runner = Matter.Runner.create({
      delta: PHYSICS_CONSTANTS.FIXED_TIMESTEP,
      isFixed: true,
    });
    // Invoke optional per-body tick hooks so blocks can own their logic
    Matter.Events.on(this.engine, 'beforeUpdate', () => {
      const bodies = Matter.Composite.allBodies(this.world);
      for (const body of bodies) {
        const anyBody = body as unknown as { onTick?: () => void };
        if (typeof anyBody.onTick === 'function') anyBody.onTick();
      }

      // Flush queued forces (apply at body center for stability)
      if (this.pendingForces.size > 0) {
        this.pendingForces.forEach((force, bodyId) => {
          const target = bodies.find(b => b.id === bodyId);
          if (target) {
            Matter.Body.applyForce(target, target.position, force);
          }
        });
        this.pendingForces.clear();
      }
    });
    // Clean up dead blocks after physics update
    Matter.Events.on(this.engine, 'afterUpdate', () => {
      this.cleanupDeadBlocks();
    });
    Matter.Runner.run(this.runner, this.engine);
  }

  /**
   * Stop the physics simulation
   */
  stop(): void {
    if (this.runner) {
      Matter.Runner.stop(this.runner);
      this.runner = null;
    }
  }

  /**
   * Manually step the simulation (for more control)
   */
  step(delta: number = PHYSICS_CONSTANTS.FIXED_TIMESTEP): void {
    Matter.Engine.update(this.engine, delta);
  }

  /**
   * Register a contraption for connectivity tracking
   */
  registerContraption(contraption: ContraptionLike): void {
    this.contraptions.set(contraption.id, contraption);
  }
  
  /**
   * Add a body to the physics world
   */
  addBody(body: Matter.Body): void {
    Matter.World.add(this.world, body);
    // Tag with engine reference for convenience (used by blocks to queue forces)
    (body as unknown as { physics?: PhysicsEngine }).physics = this;
  }

  /**
   * Add a constraint to the physics world
   */
  addConstraint(constraint: Matter.Constraint): void {
    Matter.World.add(this.world, constraint);
  }

  /**
   * Remove a body from the physics world
   */
  removeBody(body: Matter.Body): void {
    Matter.World.remove(this.world, body);
  }

  /**
   * Create a simple box body (for testing/contraptions)
   */
  createBox(x: number, y: number, width: number, height: number, options?: Matter.IBodyDefinition): Matter.Body {
    return Matter.Bodies.rectangle(x, y, width, height, options);
  }

  /**
   * Create a circle body (for wheels)
   */
  createCircle(x: number, y: number, radius: number, options?: Matter.IBodyDefinition): Matter.Body {
    return Matter.Bodies.circle(x, y, radius, options);
  }

  /**
   * Create a composite body from multiple parts
   */
  createComposite(): Matter.Composite {
    return Matter.Composite.create();
  }

  /**
   * Serialize a body's state for network transmission
   */
  serializeBody(body: Matter.Body): PhysicsBodyState {
    return {
      position: { x: body.position.x, y: body.position.y },
      velocity: { x: body.velocity.x, y: body.velocity.y },
      angle: body.angle,
      angularVelocity: body.angularVelocity,
    };
  }

  /**
   * Apply a force to a body
   */
  applyForce(body: Matter.Body, force: Vector2D): void {
    Matter.Body.applyForce(body, body.position, force);
  }

  /**
   * Queue a force to be applied on the next physics tick
   */
  queueForce(body: Matter.Body, force: Vector2D): void {
    const existing = this.pendingForces.get(body.id) || { x: 0, y: 0 };
    this.pendingForces.set(body.id, { x: existing.x + force.x, y: existing.y + force.y });
  }

  /**
   * Get all bodies in the world
   */
  getAllBodies(): Matter.Body[] {
    return Matter.Composite.allBodies(this.world);
  }

  /**
   * Clear all non-static bodies from the world
   */
  clear(): void {
    const bodies = this.getAllBodies().filter(body => !body.isStatic);
    Matter.World.remove(this.world, bodies);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stop();
    Matter.World.clear(this.world, false);
    Matter.Engine.clear(this.engine);
  }
}
