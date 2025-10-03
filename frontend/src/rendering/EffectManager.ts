/**
 * Effect Manager - handles combat visual effects
 * Optimized for performance with object pooling
 */

import Matter from 'matter-js';
import type { BaseBlock } from '@/game/contraptions/blocks/BaseBlock';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // 0-1
  maxLife: number;
  size: number;
  color: string;
}

interface DamageNumber {
  x: number;
  y: number;
  damage: number;
  life: number; // 0-1
  vy: number;
  fontSize?: number;
  color?: string;
  vx?: number;
}

interface BlockTint {
  bodyId: number;
  color: string;
  opacity: number;
  duration: number;
  elapsed: number;
}

interface GhostBlock {
  body: Matter.Body;
  opacity: number;
  life: number; // 0-1
  color: string;
  vx: number;
  vy: number;
}

interface ExplosionCircle {
  x: number;
  y: number;
  radius: number; // circle visual radius
  color: string;
  elapsed: number; // seconds since creation
  delay: number; // seconds to wait before showing (stagger)
  appearDuration: number; // seconds at full alpha (default 0.2s)
  fadeDuration: number; // seconds to fade out (0.4-0.6s)
}

const PARTICLE_POOL_SIZE = 200;
const DAMAGE_NUMBER_POOL_SIZE = 50;

export class EffectManager {
  private particles: Particle[] = [];
  private damageNumbers: DamageNumber[] = [];
  private blockTints: Map<number, BlockTint> = new Map();
  private ghostBlocks: GhostBlock[] = [];
  private explosions: ExplosionCircle[] = [];
  
  // Object pools for performance
  private particlePool: Particle[] = [];
  private damageNumberPool: DamageNumber[] = [];
  explosionFlashSizeScale: number = 2;

  constructor() {
    // Pre-allocate pools
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      this.particlePool.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, size: 0, color: '' });
    }
    for (let i = 0; i < DAMAGE_NUMBER_POOL_SIZE; i++) {
      this.damageNumberPool.push({ x: 0, y: 0, damage: 0, life: 0, vy: 0 });
    }
  }

  /**
   * Spawn an explosion burst of red circles.
   * Creates 15 circles randomly positioned within the given radius.
   * Each holds at full alpha for ~200ms, then fades over 400–600ms.
   */
  spawnExplosionFlash(x: number, y: number, radius: number, durationMs: number = 200): void {
    const appearSeconds = (durationMs / 1000) || 0.2;
    const count = 15;
    for (let i = 0; i < count; i++) {
      // Random point inside circle (uniform by area)
      const r = Math.sqrt(Math.random()) * radius;
      const theta = Math.random() * Math.PI * 2;
      const cx = x + Math.cos(theta) * r;
      const cy = y + Math.sin(theta) * r;
      // Larger circle size, biased bigger near center
      const size = this.explosionFlashSizeScale * Math.max(16, (1 - r / radius) * 40 + 20 + Math.random() * 20);
      const fadeSeconds = 0.4 + Math.random() * 0.2; // 0.4–0.6s
      const delay = Math.random() * appearSeconds; // stagger up to 200ms
      // Interpolate color between orange (255,165,0) and red (229,57,53)
      const t = Math.random();
      const rCol = Math.round(255 * (1 - t) + 229 * t);
      const gCol = Math.round(165 * (1 - t) + 57 * t);
      const bCol = Math.round(0 * (1 - t) + 53 * t);
      const color = `rgb(${rCol},${gCol},${bCol})`;
      this.explosions.push({
        x: cx,
        y: cy,
        radius: size,
        color,
        elapsed: 0,
        delay,
        appearDuration: appearSeconds,
        fadeDuration: fadeSeconds,
      });
    }
  }

  /**
   * Spawn impact particles at collision point
   */
  spawnImpactParticles(x: number, y: number, damage: number, vx: number, vy: number): void {
    const count = Math.min(Math.floor(damage / 5) + 3, 15); // Scale with damage, max 15
    for (let i = 0; i < count; i++) {
      const particle = this.particlePool.pop();
      if (!particle) break;
      
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 1.5;
      particle.x = x;
      particle.y = y;
      particle.vx = Math.cos(angle) * speed + vx * 0.3; // Inherit some velocity
      particle.vy = Math.sin(angle) * speed + vy * 0.3;
      particle.life = 1;
      particle.maxLife = 0.3 + Math.random() * 0.2;
      particle.size = 2 + Math.random() * 2;
      particle.color = '#ff6b35';
      this.particles.push(particle);
    }
  }

  /**
   * Spawn floating damage number
   */
  spawnDamageNumber(x: number, y: number, damage: number): void {
    const num = this.damageNumberPool.pop();
    if (!num) return;
    num.x = x;
    num.y = y;
    num.damage = Math.round(damage);
    num.life = 1;
    // Size and color scale with damage
    const t = Math.min(1, damage / 150); // 0 = small, 1 = big
    num.fontSize = 14 + t * 18; // 14–32px
    const r = Math.round(255 * t + 255 * (1 - t)); // always 255
    const g = Math.round(255 * (1 - t) + 57 * t); // 255 to 57
    const b = Math.round(255 * (1 - t) + 53 * t); // 255 to 53
    num.color = `rgb(${r},${g},${b})`;
    // Random movement
    num.vx = (Math.random() - 0.5) * 1.5;
    num.vy = -1.2 + Math.random() * -0.5;
    // this.damageNumbers.push(num);
  }

  /**
   * Apply tint to a block (for hit feedback)
   */
  applyBlockTint(bodyId: number, damage: number): void {
    const opacity = Math.min(damage / 50, 0.7); // Scale with damage
    this.blockTints.set(bodyId, {
      bodyId,
      color: '#ff0000',
      opacity,
      duration: 0.15, // 150ms flash
      elapsed: 0,
    });
  }

  /**
   * Create a ghost block that falls and fades
   */
  createGhostBlock(body: Matter.Body, block: BaseBlock): void {
    // Clone the body's vertices
    const vertices = body.vertices.map(v => ({ x: v.x, y: v.y }));
    
    const ghostBody = body.circleRadius
      ? Matter.Bodies.circle(body.position.x, body.position.y, body.circleRadius, { isStatic: true })
      : Matter.Bodies.fromVertices(body.position.x, body.position.y, [vertices], { isStatic: true });
    
    ghostBody.angle = body.angle;
    
    // Get block color
    const colorMap: Record<string, string> = {
      simple: '#2196f3',
      core: '#ff9800',
      spike: '#e91e63',
      wheel: '#795548',
    };
    
    // Apply small random velocity
    const vx = (Math.random() - 0.5) * 0.2;
    const vy = (Math.random() - 0.5) * 0.2;
    
    this.ghostBlocks.push({
      body: ghostBody,
      opacity: 1,
      life: 1, // 1 second
      color: colorMap[block.type] || '#888',
      vx,
      vy,
    });
  }

  /**
   * Update all effects (call each frame)
   */
  update(deltaTime: number): void {
    const dt = deltaTime / 1000; // Convert to seconds
    
    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1; // Gravity
      p.life -= dt / p.maxLife;
      
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        this.particlePool.push(p);
      }
    }
    
    // Update damage numbers
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const n = this.damageNumbers[i];
      n.x += n.vx || 0;
      n.y += n.vy || 0;
      n.life -= dt / 1.5; // 1.5 second lifetime
      if (n.life <= 0) {
        this.damageNumbers.splice(i, 1);
        this.damageNumberPool.push(n);
      }
    }
    
    // Update block tints
    this.blockTints.forEach((tint, bodyId) => {
      tint.elapsed += dt;
      if (tint.elapsed >= tint.duration) {
        this.blockTints.delete(bodyId);
      }
    });
    
    // Update ghost blocks
    for (let i = this.ghostBlocks.length - 1; i >= 0; i--) {
      const ghost = this.ghostBlocks[i];
      ghost.life -= dt;
      ghost.opacity = ghost.life; // Fade out
      
      // Apply gravity and update position
      ghost.vy += 0.5 * dt; // Gravity
      ghost.body.position.y += ghost.vy;
      ghost.body.position.x += ghost.vx;
      
      if (ghost.life <= 0) {
        this.ghostBlocks.splice(i, 1);
      }
    }

    // Update explosion circles
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.elapsed += dt;
      const visibleTime = e.elapsed - e.delay;
      if (visibleTime >= e.appearDuration + e.fadeDuration) this.explosions.splice(i, 1);
    }
  }

  /**
   * Render all effects
   */
  render(ctx: CanvasRenderingContext2D): void {
    // Render explosion circles
    this.explosions.forEach(e => {
      const t = e.elapsed - e.delay;
      if (t < 0) return; // not yet spawned
      let alpha = 1;
      if (t > e.appearDuration) {
        const k = (t - e.appearDuration) / e.fadeDuration;
        alpha = Math.max(0, 1 - k);
      }
      ctx.fillStyle = e.color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Render particles
    this.particles.forEach(p => {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.life;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    });
    ctx.globalAlpha = 1;
    
    // Render damage numbers
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    this.damageNumbers.forEach(n => {
      ctx.font = `bold ${n.fontSize || 14}px Arial`;
      ctx.fillStyle = n.color || '#fff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.globalAlpha = n.life;
      ctx.strokeText(n.damage.toString(), n.x, n.y);
      ctx.fillText(n.damage.toString(), n.x, n.y);
    });
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  /**
   * Render block tints (must be called during body rendering)
   */
  renderBlockTint(ctx: CanvasRenderingContext2D, body: Matter.Body): boolean {
    const tint = this.blockTints.get(body.id);
    if (!tint) return false;
    
    ctx.fillStyle = tint.color;
    ctx.globalAlpha = tint.opacity * (1 - tint.elapsed / tint.duration); // Fade out
    return true;
  }

  /**
   * Render ghost blocks
   */
  renderGhostBlocks(ctx: CanvasRenderingContext2D): void {
    this.ghostBlocks.forEach(ghost => {
      ctx.fillStyle = '#ff0000'; // Red tint
      ctx.globalAlpha = ghost.opacity;
      
      if (ghost.body.circleRadius) {
        ctx.beginPath();
        ctx.arc(ghost.body.position.x, ghost.body.position.y, ghost.body.circleRadius, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const vertices = ghost.body.vertices;
        ctx.beginPath();
        ctx.moveTo(vertices[0].x, vertices[0].y);
        for (let i = 1; i < vertices.length; i++) {
          ctx.lineTo(vertices[i].x, vertices[i].y);
        }
        ctx.closePath();
        ctx.fill();
      }
    });
    ctx.globalAlpha = 1;
  }

  /**
   * Render damage cracks on a block
   */
  renderDamageCracks(ctx: CanvasRenderingContext2D, body: Matter.Body, block: BaseBlock): void {
    const healthPercent = Math.max(0, block.health / block.maxHealth);
    
    // No cracks above 70% health
    if (healthPercent > 0.7) return;
    
    ctx.strokeStyle = '#000';
    ctx.globalAlpha = 0.6;
    const center = body.position;
    
    // More cracks as health decreases (50% more than before)
    // Under 25% health shows many more cracks to indicate critical damage
    const crackCount = healthPercent > 0.4 ? 3 : healthPercent > 0.25 ? 5 : 10;
    
    // Deterministic cracks based on body ID for consistency
    const seed = body.id;
    const random = (n: number) => (Math.sin(seed * n) + 1) / 2;
    
    for (let i = 0; i < crackCount; i++) {
      const angle = random(i * 3) * Math.PI * 2;
      const length = 5 + random(i * 5) * 10;
      const startOffset = random(i * 7) * 5;
      
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(
        center.x + Math.cos(angle) * startOffset,
        center.y + Math.sin(angle) * startOffset
      );
      ctx.lineTo(
        center.x + Math.cos(angle) * (startOffset + length),
        center.y + Math.sin(angle) * (startOffset + length)
      );
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Render damage cracks using only health percent (for client-rendered snapshots)
   */
  renderDamageCracksByPercent(ctx: CanvasRenderingContext2D, body: Matter.Body, healthPercent: number | undefined): void {
    if (healthPercent === undefined) return;
    const hp = Math.max(0, Math.min(1, healthPercent));
    if (hp > 0.7) return;
    ctx.strokeStyle = '#000';
    ctx.globalAlpha = 0.6;
    const center = body.position;
    const crackCount = hp > 0.4 ? 3 : hp > 0.25 ? 5 : 10;
    const seed = body.id;
    const random = (n: number) => (Math.sin(seed * n) + 1) / 2;
    for (let i = 0; i < crackCount; i++) {
      const angle = random(i * 3) * Math.PI * 2;
      const length = 5 + random(i * 5) * 10;
      const startOffset = random(i * 7) * 5;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(
        center.x + Math.cos(angle) * startOffset,
        center.y + Math.sin(angle) * startOffset
      );
      ctx.lineTo(
        center.x + Math.cos(angle) * (startOffset + length),
        center.y + Math.sin(angle) * (startOffset + length)
      );
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.particles.forEach(p => this.particlePool.push(p));
    this.damageNumbers.forEach(n => this.damageNumberPool.push(n));
    this.particles = [];
    this.damageNumbers = [];
    this.blockTints.clear();
    this.ghostBlocks = [];
    this.explosions = [];
  }
}

