/**
 * Server-side effect queue - queues effect events instead of rendering
 * Implements the same interface as EffectManager but stores events for network transmission
 */

export interface EffectEvent {
  type: 'impact' | 'damage' | 'tint' | 'explosion' | 'building';
  x: number;
  y: number;
  damage?: number;
  bodyId?: number;
  vx?: number;
  vy?: number;
  radius?: number;
  durationMs?: number;
  playerId?: string;
}

export class ServerEffectQueue {
  private events: EffectEvent[] = [];

  spawnImpactParticles(x: number, y: number, damage: number, vx: number, vy: number): void {
    this.events.push({ type: 'impact', x, y, damage, vx, vy });
  }

  spawnDamageNumber(x: number, y: number, damage: number): void {
    this.events.push({ type: 'damage', x, y, damage });
  }

  applyBlockTint(bodyId: number, damage: number): void {
    this.events.push({ type: 'tint', x: 0, y: 0, bodyId, damage });
  }

  spawnExplosionFlash(x: number, y: number, radius: number, durationMs?: number): void {
    this.events.push({ type: 'explosion', x, y, radius, durationMs });
  }

  spawnBuildingDust(x: number, y: number, durationMs: number, radius?: number, playerId?: string): void {
    this.events.push({ type: 'building', x, y, durationMs, radius, playerId });
  }

  // Ghost blocks are visual-only, no need to send to clients
  createGhostBlock(): void {
    // No-op on server
  }

  /**
   * Drain all queued events and clear the queue
   */
  drain(): EffectEvent[] {
    const result = this.events;
    this.events = [];
    return result;
  }

  /**
   * Get current events without clearing (for inspection)
   */
  peek(): EffectEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}

