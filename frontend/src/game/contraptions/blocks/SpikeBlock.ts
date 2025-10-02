/**
 * Spike Block - triangle with left attachment, damages enemy blocks on contact
 */

import Matter from 'matter-js';
import { BaseBlock, AttachmentDirection, PhysicsSpawnResult } from './BaseBlock';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';

export class SpikeBlock extends BaseBlock {
  constructor(id: string, gridX: number, gridY: number) {
    super(id, 'spike', gridX, gridY);
    this.health = 100;
    // Spikes hit harder and knock back more by default
    this.damage = 25;
    this.knockback = 0.02;
  }
  
  getAttachmentFaces(): AttachmentDirection[] {
    return ['left'];
  }
  
  // Uses BaseBlock.onCollision with stronger defaults
  
  createPhysicsBodies(worldX: number, worldY: number, direction?: number): PhysicsSpawnResult {
    const size = BUILDER_CONSTANTS.BLOCK_SIZE;
    const halfSize = size / 2;
    const dir = direction ?? 1;
    
    // Shift slightly left so attachment aligns more with block face
    const offsetX = -7 * dir;
    const baseX = worldX + offsetX;
    
    // Local triangle (attachment face on the left when dir=1, mirrored when dir=-1)
    const local = [
      { x: -halfSize, y: -halfSize }, // left-top
      { x: -halfSize, y: halfSize },  // left-bottom
      { x: halfSize, y: 0 },          // tip (right when dir=1, left when dir=-1)
    ];
    const vertices = local.map(p => ({ x: baseX + p.x * dir, y: worldY + p.y }));
    
    const body = Matter.Bodies.fromVertices(
      baseX,
      worldY,
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
}


