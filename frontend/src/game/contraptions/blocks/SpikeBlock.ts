/**
 * Spike Block - triangle with left attachment, damages enemy blocks on contact
 */

import Matter from 'matter-js';
import { BaseBlock, AttachmentDirection, PhysicsSpawnResult } from './BaseBlock';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';

export class SpikeBlock extends BaseBlock {
  static readonly BODY_OFFSET = -5; // Shift to align attachment face with grid
  
  constructor(id: string, gridX: number, gridY: number) {
    super(id, 'spike', gridX, gridY, 100);
    // Spikes hit harder and knock back more by default
    this.damage = 25;
    this.knockback = 0.02;
    this.energyCost = 0.5;
  }

  
  getAttachmentFaces(): AttachmentDirection[] {
    return ['left'];
  }
  
  protected getAttachmentPoints(face: AttachmentDirection, facingDirection: number): { pointA: Matter.Vector, pointB: Matter.Vector } {
    const halfSize = BUILDER_CONSTANTS.GRID_SIZE / 2;
    if (face === 'left') {
      // Account for body offset to align attachment with actual triangle edge
      const x = (-halfSize - SpikeBlock.BODY_OFFSET) * facingDirection;
      return {
        pointA: { x, y: -halfSize },
        pointB: { x, y: halfSize }
      };
    }
    return super.getAttachmentPoints(face, facingDirection);
  }
  
  // Uses BaseBlock.onCollision with stronger defaults
  
  createPhysicsBodies(worldX: number, worldY: number, direction?: number): PhysicsSpawnResult {
    const size = BUILDER_CONSTANTS.BLOCK_SIZE;
    const halfSize = size / 2;
    const dir = direction ?? 1;
    
    // Adjust offset based on rotation to align the attachment face after rotation

    const baseX = worldX + SpikeBlock.BODY_OFFSET * dir;
    const baseY = worldY;
    
    // Local triangle (attachment face on the left when dir=1, mirrored when dir=-1)
    const local = [
      { x: -halfSize, y: -halfSize }, // left-top
      { x: -halfSize, y: halfSize },  // left-bottom
      { x: halfSize, y: 0 },          // tip (right when dir=1, left when dir=-1)
    ];
    const vertices = local.map(p => ({ x: baseX + p.x * dir, y: baseY + p.y }));
    
    const body = Matter.Bodies.fromVertices(
      baseX,
      baseY,
      [vertices],
      { 
        label: this.id,
        render: { fillStyle: '#e91e63', strokeStyle: '#000', lineWidth: 2 }
      }
    );
    
    // Collision handler now provided by Contraption during assembly
    
    return {
      bodies: [body],
      constraints: [],
      primaryBody: body,
    };
  }

  applyResistance(amount: number, type: import('./BaseBlock').DamageType): number {
    if (type === 'sharp' || type === 'blunt') {
      return amount * 0.1;
    }
    return amount;
  }
}


