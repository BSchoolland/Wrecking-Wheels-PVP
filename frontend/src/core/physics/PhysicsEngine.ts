/**
 * Physics Engine - Wrapper around Matter.js
 * Runs ONLY on the host machine
 */

import Matter from 'matter-js';
import { PHYSICS_CONSTANTS } from '@shared/constants/physics';
import type { PhysicsBodyState, Vector2D } from '@shared/types/GameState';
import { createMapBoundaries } from '@/game/terrain/MapLoader';

export class PhysicsEngine {
  private engine: Matter.Engine;
  private world: Matter.World;
  private runner: Matter.Runner | null = null;

  constructor() {
    // Create Matter.js engine
    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: PHYSICS_CONSTANTS.GRAVITY, scale: 0.001 },
    });
    this.world = this.engine.world;

    // Create world boundaries
    this.createBoundaries();
  }

  private createBoundaries(): void {
    const boundaries = createMapBoundaries();
    Matter.World.add(this.world, boundaries);
  }

  /**
   * Start the physics simulation with fixed timestep
   */
  start(): void {
    this.runner = Matter.Runner.create({
      delta: PHYSICS_CONSTANTS.FIXED_TIMESTEP,
      isFixed: true,
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
   * Add a body to the physics world
   */
  addBody(body: Matter.Body): void {
    Matter.World.add(this.world, body);
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
