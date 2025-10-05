/**
 * Gray Block - high health defensive block
 */

import Matter from 'matter-js';
import { BaseBlock, AttachmentDirection, PhysicsSpawnResult } from './BaseBlock';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';

export class GrayBlock extends BaseBlock {
  constructor(id: string, gridX: number, gridY: number) {
    super(id, 'gray', gridX, gridY);
    this.health = 100;
    this.damage = 4;
    this.materialCost = 0.1;
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
  applyResistance(amount: number, type: import('./BaseBlock').DamageType): number {
    if (type === 'sharp') {
      return amount * 0.05;
    }
    if (type === 'blunt') {
      return amount * 0.1;
    }
    return amount;
  }
}

