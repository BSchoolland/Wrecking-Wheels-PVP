/**
 * Gray Block - high health defensive block
 */

import Matter from 'matter-js';
import { BaseBlock, AttachmentDirection, PhysicsSpawnResult } from './BaseBlock';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';

export class GrayBlock extends BaseBlock {
  constructor(id: string, gridX: number, gridY: number) {
    super(id, 'gray', gridX, gridY);
    this.health = 2000;
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
        render: { fillStyle: '#757575', strokeStyle: '#000', lineWidth: 2 }
      }
    );
    
    return {
      bodies: [body],
      constraints: [],
      primaryBody: body,
    };
  }
}

