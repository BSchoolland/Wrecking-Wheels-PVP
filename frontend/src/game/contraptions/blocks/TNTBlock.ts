/**
 * TNT Block - explodes on destruction
 */

import Matter from 'matter-js';
import { BaseBlock, AttachmentDirection, PhysicsSpawnResult } from './BaseBlock';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';

export class TNTBlock extends BaseBlock {
  constructor(id: string, gridX: number, gridY: number) {
    super(id, 'tnt' as any, gridX, gridY, 25);
    this.damage = 0;
    this.knockback = 0;
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
        render: { fillStyle: '#e53935', strokeStyle: '#000', lineWidth: 2 }
      }
    );

    return {
      bodies: [body],
      constraints: [],
      primaryBody: body,
    };
  }
}


