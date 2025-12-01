/**
 * Physics Engine - Wrapper around Matter.js
 * Runs on the host (authoritative) and optionally on clients for prediction/replay
 */

import Matter from 'matter-js';
import { PHYSICS_CONSTANTS, WORLD_BOUNDS } from '@shared/constants/physics';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';
import { GAME_CONSTANTS } from '@shared/constants/game';
import type { PhysicsBodyState, Vector2D } from '@shared/types/GameState';
import { createMapBoundaries } from '@/game/terrain/MapLoader';
import type { BaseBlock } from '@/game/contraptions/blocks/BaseBlock';
import type { EffectManager } from '@/rendering/EffectManager';

interface ContraptionLike {
  id: string;
  checkConnectivity?: () => void;
}

interface PhysicsEngineOptions {
  createBoundaries?: boolean;
}

export class PhysicsEngine {
  private engine: Matter.Engine;
  private world: Matter.World;
  private runner: Matter.Runner | null = null;
  private eventsInitialized = false;
  private bodiesToRemove: Set<Matter.Body> = new Set();
  private constraintsToRemove: Set<Matter.Constraint> = new Set();
  private pendingForces: Map<number, { x: number, y: number }> = new Map();
  private contraptions: Map<string, ContraptionLike> = new Map();
  private wheelInput: Map<string, number> = new Map();
  private effects: EffectManager | null = null;
  private activeCollisions: Map<string, number> = new Map(); // Track collision start times
  private botPlayers: Set<string> = new Set();
  private rocketHold: Map<string, boolean> = new Map();
  
  // Map shrinking
  private groundBodies: Matter.Body[] = [];
  private mapShrinkStartTime: number | null = null;
  private lastBlockDestroyTime: number | null = null;

  constructor(options: PhysicsEngineOptions = {}) {
    const { createBoundaries = true } = options;
    // Create Matter.js engine
    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: PHYSICS_CONSTANTS.GRAVITY, scale: 0.001 },
    });
    this.world = this.engine.world;

    // Create world boundaries
    if (createBoundaries) {
      this.createBoundaries();
    }
    
    // Set up collision detection
    this.setupCollisionHandling();
  }

  private createBoundaries(): void {
    const boundaries = createMapBoundaries();
    // Store ground bodies separately for map shrinking
    this.groundBodies = boundaries.filter(b => b.label === 'ground');
    Matter.World.add(this.world, boundaries);
  }

  private setupCollisionHandling(): void {
    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      event.pairs.forEach(pair => {
        const bodyA = pair.bodyA;
        const bodyB = pair.bodyB;
        
        // Track collision start time
        const key = this.getCollisionKey(bodyA.id, bodyB.id);
        this.activeCollisions.set(key, Date.now());
        
        // Call onCollision callback if body has one
        const onCollisionA = (bodyA as unknown as { onCollision?: (myBody: Matter.Body, otherBody: Matter.Body) => void }).onCollision;
        const onCollisionB = (bodyB as unknown as { onCollision?: (myBody: Matter.Body, otherBody: Matter.Body) => void }).onCollision;
        
        if (onCollisionA) onCollisionA(bodyA, bodyB);
        if (onCollisionB) onCollisionB(bodyB, bodyA);
      });
    });

    Matter.Events.on(this.engine, 'collisionEnd', (event) => {
      event.pairs.forEach(pair => {
        const key = this.getCollisionKey(pair.bodyA.id, pair.bodyB.id);
        this.activeCollisions.delete(key);
      });
    });

    Matter.Events.on(this.engine, 'collisionActive', (event) => {
      const now = Date.now();
      event.pairs.forEach(pair => {
        const key = this.getCollisionKey(pair.bodyA.id, pair.bodyB.id);
        const startTime = this.activeCollisions.get(key);
        
        // If collision has been active for > 250ms, re-trigger damage
        if (startTime && now - startTime > 250) {
          const bodyA = pair.bodyA;
          const bodyB = pair.bodyB;
          
          const onCollisionA = (bodyA as unknown as { onCollision?: (myBody: Matter.Body, otherBody: Matter.Body) => void }).onCollision;
          const onCollisionB = (bodyB as unknown as { onCollision?: (myBody: Matter.Body, otherBody: Matter.Body) => void }).onCollision;
          
          if (onCollisionA) onCollisionA(bodyA, bodyB);
          if (onCollisionB) onCollisionB(bodyB, bodyA);
          
          // Reset timer for next check
          this.activeCollisions.set(key, now);
        }
      });
    });
  }

  private getCollisionKey(idA: number, idB: number): string {
    return idA < idB ? `${idA}-${idB}` : `${idB}-${idA}`;
  }

  /**
   * Update map shrinking - progressively destroy ground blocks from both edges
   */
  private updateMapShrinking(): void {
    // Only proceed if map shrinking has been explicitly enabled
    if (this.mapShrinkStartTime === null) {
      return;
    }

    const now = Date.now();
    const elapsed = now - this.mapShrinkStartTime;
    
    // Check if shrinking should have started
    if (elapsed < GAME_CONSTANTS.MAP_SHRINK_START_MS) {
      return; // Not time to start yet
    }

    // Get remaining bodies still in the world
    const remainingBodies = this.groundBodies.filter(b => this.world.bodies.includes(b));
    
    if (remainingBodies.length === 0) {
      return; // All blocks already destroyed
    }

    // Initialize last destroy time on first shrink
    if (this.lastBlockDestroyTime === null) {
      this.lastBlockDestroyTime = now;
    }

    // Check if enough time has passed to destroy the next block
    if (now - this.lastBlockDestroyTime >= GAME_CONSTANTS.MAP_SHRINK_DESTROY_INTERVAL_MS) {
      // Sort by distance from center
      const centerX = WORLD_BOUNDS.WIDTH / 2;
      const sortedByDistance = remainingBodies
        .map(body => ({ body, distFromCenter: Math.abs(body.position.x - centerX) }))
        .sort((a, b) => b.distFromCenter - a.distFromCenter); // Farthest first (edges)

      // Define decay zone: farthest X% of blocks can randomly decay
      const decayZoneSize = Math.max(1, Math.ceil(sortedByDistance.length * 0.05));
      const decayZone = sortedByDistance.slice(0, decayZoneSize);

      // Randomly pick one from the decay zone
      const randomIndex = Math.floor(Math.random() * decayZone.length);
      this.bodiesToRemove.add(decayZone[randomIndex].body);
      this.lastBlockDestroyTime = now;
    }
  }

  private cleanupDeadBlocks(): void {
    const allBodies = Matter.Composite.allBodies(this.world);
    const allConstraints = Matter.Composite.allConstraints(this.world);
    const affectedContraptions = new Set<string>();
    const explodedBlocks = new Set<string>();
    const deadBlockIds = new Set<string>();
    
    // Find blocks with 0 health
    allBodies.forEach(body => {
      const block = (body as unknown as { block?: BaseBlock }).block;
      if (block && block.health <= 0) {
        // Track the whole block so we can remove all sibling bodies (e.g., wheels)
        const blockId = (body as unknown as { blockId?: string }).blockId;
        if (blockId) deadBlockIds.add(blockId);
        // Trigger TNT explosion once per block
        if ((block as unknown as { type?: string }).type === 'tnt' && !explodedBlocks.has(block.id)) {
          explodedBlocks.add(block.id);
          const center = body.position;
          const BLAST_RADIUS = BUILDER_CONSTANTS.GRID_SIZE * 5;
          const INNER_RADIUS = BLAST_RADIUS / 2;
          const DAMAGE_OUTER = 50;
          const DAMAGE_INNER = 150;
          const KNOCKBACK_OUTER = 0.06; // strong push
          const KNOCKBACK_INNER = 0.14; // even stronger push

          allBodies.forEach(targetBody => {
            if (targetBody === body) return;
            const targetBlock = (targetBody as unknown as { block?: BaseBlock }).block;
            if (!targetBlock || targetBlock.health <= 0) return;

            const dx = targetBody.position.x - center.x;
            const dy = targetBody.position.y - center.y;
            const dist = Math.hypot(dx, dy);
            if (dist <= BLAST_RADIUS && dist > 0) {
              const nx = dx / dist;
              const ny = dy / dist;
              const isInner = dist <= INNER_RADIUS;
              const damage = isInner ? DAMAGE_INNER : DAMAGE_OUTER;
              const knock = isInner ? KNOCKBACK_INNER : KNOCKBACK_OUTER;

              // Apply damage ignoring team/contraption, but allow resistance
              let finalDamage = damage;
              if (typeof targetBlock.applyResistance === 'function') {
                finalDamage = targetBlock.applyResistance(damage, 'blast');
              }
              targetBlock.health -= finalDamage;

              // Wake and apply radial impulse
              Matter.Sleeping.set(targetBody, false);
              const physics = (targetBody as unknown as { physics?: { queueForce: (b: Matter.Body, f: Matter.Vector) => void } }).physics;
              const force = { x: nx * knock, y: ny * knock };
              if (physics) {
                physics.queueForce(targetBody, force);
              } else if (!targetBody.isStatic) {
                Matter.Body.applyForce(targetBody, targetBody.position, force);
              }

              // Effect feedback
              const effects = (body as unknown as { effects?: EffectManager }).effects;
              if (effects) {
                effects.spawnImpactParticles(center.x, center.y, finalDamage, nx * knock, ny * knock);
                effects.spawnDamageNumber(targetBody.position.x, targetBody.position.y - 15, finalDamage);
              }
            }
          });

          // Single explosion flash at center (200ms)
          const effects = (body as unknown as { effects?: EffectManager }).effects;
          if (effects) {
            effects.spawnExplosionFlash(center.x, center.y, BLAST_RADIUS, 200);
          }
        }

        this.bodiesToRemove.add(body);
        const contraptionId = (body as unknown as { contraptionId?: string }).contraptionId;
        if (contraptionId) affectedContraptions.add(contraptionId);
        
        // Spawn ghost block effect
        if (this.effects) {
          this.effects.createGhostBlock(body, block);
        }
      }
      // Destroy core blocks that fall off the map
      else if (block && (block as unknown as { type?: string }).type === 'core' && body.position.y > WORLD_BOUNDS.HEIGHT + 500) {
        block.health = 0;
        const blockId = (body as unknown as { blockId?: string }).blockId;
        if (blockId) deadBlockIds.add(blockId);
        this.bodiesToRemove.add(body);
        const contraptionId = (body as unknown as { contraptionId?: string }).contraptionId;
        if (contraptionId) affectedContraptions.add(contraptionId);
        
        if (this.effects) {
          this.effects.createGhostBlock(body, block);
        }
      }
    });

    // Also remove any sibling bodies that belong to dead blocks (matched by blockId)
    if (deadBlockIds.size > 0) {
      allBodies.forEach(body => {
        const bid = (body as unknown as { blockId?: string }).blockId;
        if (bid && deadBlockIds.has(bid)) {
          this.bodiesToRemove.add(body);
        }
      });
    }
    
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
    if (!this.eventsInitialized) {
      this.eventsInitialized = true;
      // Invoke optional per-body tick hooks so blocks can own their logic
      Matter.Events.on(this.engine, 'beforeUpdate', () => {
        const bodies = Matter.Composite.allBodies(this.world);
        for (const body of bodies) {
          const anyBody = body as unknown as { onTick?: () => void };
          if (typeof anyBody.onTick === 'function') anyBody.onTick();

          // Apply simple torque to wheel bodies based on per-player input
          const ownerId = (body as unknown as { ownerId?: string }).ownerId;
          if (ownerId && body.label?.endsWith('-wheel')) {
            let input = this.wheelInput.get(ownerId) || 0;
            if (!this.wheelInput.has(ownerId) && this.botPlayers.has(ownerId)) input = 1; // bots drive forward by default
            (body as unknown as { currentWheelInput?: number }).currentWheelInput = input;
          }
          // Apply rocket hold state: thrust only while held
          if (ownerId && body.label?.endsWith('-rocket')) {
            const hold = this.rocketHold.get(ownerId) || false;
            (body as unknown as { rocketThrusting?: boolean }).rocketThrusting = hold;
            // Expose sprite column for rendering (0 = idle, 1 = active)
            (body as unknown as { spriteCol?: number }).spriteCol = hold ? 1 : 0;
          }
        }

        // Flush queued forces (apply at body center for stability)
        if (this.pendingForces.size > 0) {
          this.pendingForces.forEach((force, bodyId) => {
            const target = bodies.find(b => b.id === bodyId);
            if (target && !target.isStatic) {
              Matter.Body.applyForce(target, target.position, force);
            }
          });
          this.pendingForces.clear();
        }
      });
      // Clean up dead blocks after physics update
      Matter.Events.on(this.engine, 'afterUpdate', () => {
        this.cleanupDeadBlocks();
        this.updateMapShrinking();
      });
    }

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
   * Register a contraption for connectivity tracking
   */
  registerContraption(contraption: ContraptionLike): void {
    this.contraptions.set(contraption.id, contraption);
  }

  /**
   * Set the effect manager for visual effects
   */
  setEffectManager(effects: EffectManager): void {
    this.effects = effects;
  }
  
  /**
   * Add a body to the physics world
   */
  addBody(body: Matter.Body): void {
    Matter.World.add(this.world, body);
    // Tag with engine reference for convenience (used by blocks to queue forces)
    (body as unknown as { physics?: PhysicsEngine }).physics = this;
    // Tag with effects manager for visual effects
    (body as unknown as { effects?: EffectManager }).effects = this.effects || undefined;
  }

  /**
   * Add a constraint to the physics world
   */
  addConstraint(constraint: Matter.Constraint): void {
    Matter.World.add(this.world, constraint);
  }

  /**
   * Remove a constraint from the physics world
   */
  removeConstraint(constraint: Matter.Constraint): void {
    Matter.World.remove(this.world, constraint);
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
  createBox(x: number, y: number, width: number, height: number, options?: Partial<Matter.IBodyDefinition>): Matter.Body {
    return Matter.Bodies.rectangle(x, y, width, height, options);
  }

  /**
   * Create a circle body (for wheels)
   */
  createCircle(x: number, y: number, radius: number, options?: Partial<Matter.IBodyDefinition>): Matter.Body {
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
    if (!body.isStatic) {
      Matter.Body.applyForce(body, body.position, force);
    }
  }

  /**
   * Queue a force to be applied on the next physics tick
   */
  queueForce(body: Matter.Body, force: Vector2D): void {
    if (!body.isStatic) {
      const existing = this.pendingForces.get(body.id) || { x: 0, y: 0 };
      this.pendingForces.set(body.id, { x: existing.x + force.x, y: existing.y + force.y });
    }
  }

  /**
   * Get all bodies in the world
   */
  getAllBodies(): Matter.Body[] {
    return Matter.Composite.allBodies(this.world);
  }

  /**
   * Enable map shrinking (call when match starts in PVP mode)
   */
  enableMapShrinking(): void {
    this.mapShrinkStartTime = Date.now();
  }

  /**
   * Get all constraints in the world
   */
  getAllConstraints(): Matter.Constraint[] {
    return Matter.Composite.allConstraints(this.world);
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

  public setWheelInput(playerId: string, value: number): void {
    const v = Math.max(-1, Math.min(1, value));
    if (v === 0) this.wheelInput.delete(playerId); else this.wheelInput.set(playerId, v);
  }

  // Hinge input is handled entirely within HingeBlock; no physics hook needed

  public setBot(playerId: string, isBot: boolean): void {
    if (isBot) this.botPlayers.add(playerId); else this.botPlayers.delete(playerId);
  }

  public setRocketHold(playerId: string, value: boolean): void {
    if (value) this.rocketHold.set(playerId, true); else this.rocketHold.delete(playerId);
  }
}
