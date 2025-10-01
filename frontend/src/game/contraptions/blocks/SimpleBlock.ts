/**
 * Simple Block - can attach on all 4 sides
 */

import Matter from 'matter-js';
import { BaseBlock, AttachmentDirection, PhysicsSpawnResult } from './BaseBlock';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';

export class SimpleBlock extends BaseBlock {
  constructor(id: string, gridX: number, gridY: number) {
    super(id, 'simple', gridX, gridY);
  }
  
  getAttachmentFaces(): AttachmentDirection[] {
    return ['top', 'right', 'bottom', 'left'];
  }
  
  createPhysicsBodies(worldX: number, worldY: number): PhysicsSpawnResult {
    const body = Matter.Bodies.rectangle(
      worldX,
      worldY,
      BUILDER_CONSTANTS.BLOCK_SIZE,
      BUILDER_CONSTANTS.BLOCK_SIZE,
      { label: this.id }
    );
    
    return {
      bodies: [body],
      constraints: [],
      primaryBody: body,
    };
  }
}

