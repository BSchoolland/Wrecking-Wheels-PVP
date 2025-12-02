/**
 * Physics Engine - Wrapper around Matter.js
 * Runs on the server (authoritative) and on clients for prediction
 */

import Matter from 'matter-js';
import { PHYSICS_CONSTANTS, WORLD_BOUNDS } from '@shared/constants/physics';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';
import { GAME_CONSTANTS } from '@shared/constants/game';
import type { PhysicsBodyState, Vector2D } from '@shared/types/GameState';
import { createMapBoundaries } from '@shared/terrain/MapLoader';

// Optional effects interface - only used on client
interface EffectsInterface {
  spawnImpactParticles?: (x: number, y: number, damage: number, vx: number, vy: number) => void;
  spawnDamageNumber?: (x: number, y: number, damage: number) => void;
  applyBlockTint?: (id: number, damage: number) => void;
  spawnExplosionFlash?: (x: number, y: number, radius: number, durationMs?: number) => void;
  createGhostBlock?: (body: Matter.Body, block: unknown) => void;
}

// Block interface for type-safe access
interface BaseBlockLike {
  id: string;
  type?: string;
  health: number;
  maxHealth: number;
  applyResistance?: (amount: number, type: string) => number;
}

interface ContraptionLike {
  id: string;
  checkConnectivity?: () => void;
}

interface PhysicsEngineOptions {
  createBoundaries?: boolean;
  isServer?: boolean;  // Set to true on server, false/undefined on client
}

export class PhysicsEngine {
  private engine: Matter.Engine;
  private world: Matter.World;
  private runner: Matter.Runner | null = null;
  private serverIntervalId: ReturnType<typeof setInterval> | null = null;
  private eventsInitialized = false;
  private bodiesToRemove: Set<Matter.Body> = new Set();
  private constraintsToRemove: Set<Matter.Constraint> = new Set();
  private pendingForces: Map<number, { x: number, y: number }> = new Map();
  private contraptions: Map<string, ContraptionLike> = new Map();
  private wheelInput: Map<string, number> = new Map();
  private hingeInput: Map<string, number> = new Map();
  private effects: EffectsInterface | null = null;
  private activeCollisions: Map<string, number> = new Map();
  private botPlayers: Set<string> = new Set();
  private rocketHold: Map<string, boolean> = new Map();
  private isServer: boolean;
  
  // Map shrinking
  private groundBodies: Matter.Body[] = [];
  private mapShrinkStartTime: number | null = null;
  private lastBlockDestroyTime: number | null = null;

  constructor(options: PhysicsEngineOptions = {}) {
    const { createBoundaries = true, isServer = false } = options;
    this.isServer = isServer;
    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: PHYSICS_CONSTANTS.GRAVITY, scale: 0.001 },
    });
    this.world = this.engine.world;

    if (createBoundaries) {
      this.createBoundaries();
    }
    
    this.setupCollisionHandling();
  }

  private createBoundaries(): void {
    const boundaries = createMapBoundaries();
    this.groundBodies = boundaries.filter(b => b.label === 'ground');
    Matter.World.add(this.world, boundaries);
  }

  private setupCollisionHandling(): void {
    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      event.pairs.forEach(pair => {
        const bodyA = pair.bodyA;
        const bodyB = pair.bodyB;
        
        const key = this.getCollisionKey(bodyA.id, bodyB.id);
        this.activeCollisions.set(key, Date.now());
        
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
        
        if (startTime && now - startTime > 250) {
          const bodyA = pair.bodyA;
          const bodyB = pair.bodyB;
          
          const onCollisionA = (bodyA as unknown as { onCollision?: (myBody: Matter.Body, otherBody: Matter.Body) => void }).onCollision;
          const onCollisionB = (bodyB as unknown as { onCollision?: (myBody: Matter.Body, otherBody: Matter.Body) => void }).onCollision;
          
          if (onCollisionA) onCollisionA(bodyA, bodyB);
          if (onCollisionB) onCollisionB(bodyB, bodyA);
          
          this.activeCollisions.set(key, now);
        }
      });
    });
  }

  private getCollisionKey(idA: number, idB: number): string {
    return idA < idB ? `${idA}-${idB}` : `${idB}-${idA}`;
  }

  private updateMapShrinking(): void {
    if (this.mapShrinkStartTime === null) {
      return;
    }

    const now = Date.now();
    const elapsed = now - this.mapShrinkStartTime;
    
    if (elapsed < GAME_CONSTANTS.MAP_SHRINK_START_MS) {
      return;
    }

    const remainingBodies = this.groundBodies.filter(b => this.world.bodies.includes(b));
    
    if (remainingBodies.length === 0) {
      return;
    }

    if (this.lastBlockDestroyTime === null) {
      this.lastBlockDestroyTime = now;
    }

    if (now - this.lastBlockDestroyTime >= GAME_CONSTANTS.MAP_SHRINK_DESTROY_INTERVAL_MS) {
      const centerX = WORLD_BOUNDS.WIDTH / 2;
      const sortedByDistance = remainingBodies
        .map(body => ({ body, distFromCenter: Math.abs(body.position.x - centerX) }))
        .sort((a, b) => b.distFromCenter - a.distFromCenter);

      const decayZoneSize = Math.max(1, Math.ceil(sortedByDistance.length * 0.05));
      const decayZone = sortedByDistance.slice(0, decayZoneSize);

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
    
    allBodies.forEach(body => {
      const block = (body as unknown as { block?: BaseBlockLike }).block;
      if (block && block.health <= 0) {
        const blockId = (body as unknown as { blockId?: string }).blockId;
        if (blockId) deadBlockIds.add(blockId);
        if (block.type === 'tnt' && !explodedBlocks.has(block.id)) {
          explodedBlocks.add(block.id);
          const center = body.position;
          const BLAST_RADIUS = BUILDER_CONSTANTS.GRID_SIZE * 5;
          const INNER_RADIUS = BLAST_RADIUS / 2;
          const DAMAGE_OUTER = 50;
          const DAMAGE_INNER = 150;
          const KNOCKBACK_OUTER = 0.06;
          const KNOCKBACK_INNER = 0.14;

          allBodies.forEach(targetBody => {
            if (targetBody === body) return;
            const targetBlock = (targetBody as unknown as { block?: BaseBlockLike }).block;
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

              let finalDamage = damage;
              if (typeof targetBlock.applyResistance === 'function') {
                finalDamage = targetBlock.applyResistance(damage, 'blast');
              }
              targetBlock.health -= finalDamage;

              Matter.Sleeping.set(targetBody, false);
              const physics = (targetBody as unknown as { physics?: PhysicsEngine }).physics;
              const force = { x: nx * knock, y: ny * knock };
              if (physics) {
                physics.queueForce(targetBody, force);
              } else if (!targetBody.isStatic) {
                Matter.Body.applyForce(targetBody, targetBody.position, force);
              }

              if (this.effects) {
                this.effects.spawnImpactParticles?.(center.x, center.y, finalDamage, nx * knock, ny * knock);
                this.effects.spawnDamageNumber?.(targetBody.position.x, targetBody.position.y - 15, finalDamage);
              }
            }
          });

          if (this.effects) {
            this.effects.spawnExplosionFlash?.(center.x, center.y, BLAST_RADIUS, 200);
          }
        }

        this.bodiesToRemove.add(body);
        const contraptionId = (body as unknown as { contraptionId?: string }).contraptionId;
        if (contraptionId) affectedContraptions.add(contraptionId);

        if (this.effects) {
          this.effects.createGhostBlock?.(body, block);
        }
      }
      else if (block && block.type === 'core' && body.position.y > WORLD_BOUNDS.HEIGHT + 500) {
        block.health = 0;
        const blockId = (body as unknown as { blockId?: string }).blockId;
        if (blockId) deadBlockIds.add(blockId);
        this.bodiesToRemove.add(body);
        const contraptionId = (body as unknown as { contraptionId?: string }).contraptionId;
        if (contraptionId) affectedContraptions.add(contraptionId);

        if (this.effects) {
          this.effects.createGhostBlock?.(body, block);
        }
      }
    });

    if (deadBlockIds.size > 0) {
      allBodies.forEach(body => {
        const bid = (body as unknown as { blockId?: string }).blockId;
        if (bid && deadBlockIds.has(bid)) {
          this.bodiesToRemove.add(body);
        }
      });
    }
    
    allConstraints.forEach(constraint => {
      if (constraint.bodyA && this.bodiesToRemove.has(constraint.bodyA)) {
        this.constraintsToRemove.add(constraint);
      }
      if (constraint.bodyB && this.bodiesToRemove.has(constraint.bodyB)) {
        this.constraintsToRemove.add(constraint);
      }
    });
    
    if (this.bodiesToRemove.size > 0) {
      Matter.World.remove(this.world, Array.from(this.bodiesToRemove));
      this.bodiesToRemove.clear();
    }
    if (this.constraintsToRemove.size > 0) {
      Matter.World.remove(this.world, Array.from(this.constraintsToRemove) as unknown as Matter.Body);
      this.constraintsToRemove.clear();
    }
    
    affectedContraptions.forEach(id => {
      const contraption = this.contraptions.get(id);
      if (contraption?.checkConnectivity) {
        contraption.checkConnectivity();
      }
    });
  }

  start(): void {
    if (!this.eventsInitialized) {
      this.eventsInitialized = true;
      Matter.Events.on(this.engine, 'beforeUpdate', () => {
        const bodies = Matter.Composite.allBodies(this.world);
        for (const body of bodies) {
          const anyBody = body as unknown as { onTick?: () => void };
          if (typeof anyBody.onTick === 'function') anyBody.onTick();

          const ownerId = (body as unknown as { ownerId?: string }).ownerId;
          if (ownerId && body.label?.endsWith('-wheel')) {
            let input = this.wheelInput.get(ownerId) || 0;
            if (!this.wheelInput.has(ownerId) && this.botPlayers.has(ownerId)) input = 1;
            (body as unknown as { currentWheelInput?: number }).currentWheelInput = input;
          }
          if (ownerId && body.label?.endsWith('-hinge')) {
            const input = this.hingeInput.get(ownerId) || 0;
            (body as unknown as { currentHingeInput?: number }).currentHingeInput = input;
          }
          if (ownerId && body.label?.endsWith('-rocket')) {
            const hold = this.rocketHold.get(ownerId) || false;
            (body as unknown as { rocketThrusting?: boolean }).rocketThrusting = hold;
            // Only server updates spriteCol; client reads it from network snapshots
            if (this.isServer) {
              (body as unknown as { spriteCol?: number }).spriteCol = hold ? 1 : 0;
            }
          }
        }

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
      Matter.Events.on(this.engine, 'afterUpdate', () => {
        this.cleanupDeadBlocks();
        this.updateMapShrinking();
      });
    }

    // Check if we're in a browser or server environment
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isBrowser = typeof (globalThis as any).window !== 'undefined' && 
      typeof (globalThis as any).window.requestAnimationFrame === 'function';
    
    if (isBrowser) {
      this.runner = Matter.Runner.create({
        delta: PHYSICS_CONSTANTS.FIXED_TIMESTEP,
        isFixed: true,
      });
      Matter.Runner.run(this.runner, this.engine);
    } else {
      // Server: use setInterval for physics stepping
      this.serverIntervalId = setInterval(() => {
        Matter.Engine.update(this.engine, PHYSICS_CONSTANTS.FIXED_TIMESTEP);
      }, PHYSICS_CONSTANTS.FIXED_TIMESTEP);
    }
  }

  stop(): void {
    if (this.runner) {
      Matter.Runner.stop(this.runner);
      this.runner = null;
    }
    if (this.serverIntervalId !== null) {
      clearInterval(this.serverIntervalId);
      this.serverIntervalId = null;
    }
  }

  step(delta: number = PHYSICS_CONSTANTS.FIXED_TIMESTEP): void {
    Matter.Engine.update(this.engine, delta);
  }

  registerContraption(contraption: ContraptionLike): void {
    this.contraptions.set(contraption.id, contraption);
  }

  setEffectManager(effects: EffectsInterface): void {
    this.effects = effects;
  }
  
  addBody(body: Matter.Body): void {
    Matter.World.add(this.world, body);
    (body as unknown as { physics?: PhysicsEngine }).physics = this;
    (body as unknown as { effects?: EffectsInterface }).effects = this.effects || undefined;
  }

  addConstraint(constraint: Matter.Constraint): void {
    Matter.World.add(this.world, constraint);
  }

  removeConstraint(constraint: Matter.Constraint): void {
    Matter.World.remove(this.world, constraint);
  }

  removeBody(body: Matter.Body): void {
    Matter.World.remove(this.world, body);
  }

  createBox(x: number, y: number, width: number, height: number, options?: Partial<Matter.IBodyDefinition>): Matter.Body {
    return Matter.Bodies.rectangle(x, y, width, height, options);
  }

  createCircle(x: number, y: number, radius: number, options?: Partial<Matter.IBodyDefinition>): Matter.Body {
    return Matter.Bodies.circle(x, y, radius, options);
  }

  createComposite(): Matter.Composite {
    return Matter.Composite.create();
  }

  serializeBody(body: Matter.Body): PhysicsBodyState {
    return {
      position: { x: body.position.x, y: body.position.y },
      velocity: { x: body.velocity.x, y: body.velocity.y },
      angle: body.angle,
      angularVelocity: body.angularVelocity,
    };
  }

  applyForce(body: Matter.Body, force: Vector2D): void {
    if (!body.isStatic) {
      Matter.Body.applyForce(body, body.position, force);
    }
  }

  queueForce(body: Matter.Body, force: Vector2D): void {
    if (!body.isStatic) {
      const existing = this.pendingForces.get(body.id) || { x: 0, y: 0 };
      this.pendingForces.set(body.id, { x: existing.x + force.x, y: existing.y + force.y });
    }
  }

  getAllBodies(): Matter.Body[] {
    return Matter.Composite.allBodies(this.world);
  }

  enableMapShrinking(): void {
    this.mapShrinkStartTime = Date.now();
  }

  getAllConstraints(): Matter.Constraint[] {
    return Matter.Composite.allConstraints(this.world);
  }

  clear(): void {
    const bodies = this.getAllBodies().filter(body => !body.isStatic);
    Matter.World.remove(this.world, bodies);
  }

  destroy(): void {
    this.stop();
    Matter.World.clear(this.world, false);
    Matter.Engine.clear(this.engine);
  }

  public setHingeInput(playerId: string, value: number): void {
    const v = Math.max(-1, Math.min(1, value));
    if (v === 0) this.hingeInput.delete(playerId); else this.hingeInput.set(playerId, v);
  }

  public setWheelInput(playerId: string, value: number): void {
    const v = Math.max(-1, Math.min(1, value));
    if (v === 0) this.wheelInput.delete(playerId); else this.wheelInput.set(playerId, v);
  }

  public setBot(playerId: string, isBot: boolean): void {
    if (isBot) this.botPlayers.add(playerId); else this.botPlayers.delete(playerId);
  }

  public setRocketHold(playerId: string, value: boolean): void {
    if (value) this.rocketHold.set(playerId, true); else this.rocketHold.delete(playerId);
  }
}

