/**
 * Core Block - can attach on all 4 sides
 */

import Matter from 'matter-js';
import { BaseBlock, AttachmentDirection, PhysicsSpawnResult } from './BaseBlock';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';

export class CoreBlock extends BaseBlock {
  constructor(id: string, gridX: number, gridY: number) {
    super(id, 'core', gridX, gridY, 100);
    this.fragile = true;
    this.energyCost = 0.2;
  }
  
  getAttachmentFaces(): AttachmentDirection[] {
    return ['top', 'right', 'bottom', 'left'];
  }
  
  createPhysicsBodies(worldX: number, worldY: number, _direction?: number): PhysicsSpawnResult {
    const body = Matter.Bodies.rectangle(
      worldX,
      worldY,
      BUILDER_CONSTANTS.BLOCK_SIZE,
      BUILDER_CONSTANTS.BLOCK_SIZE,
      { 
        label: this.id,
        render: { fillStyle: '#ff9800', strokeStyle: '#000', lineWidth: 2 }
      }
    );
    
    return {
      bodies: [body],
      constraints: [],
      primaryBody: body,
    };
  }
}

