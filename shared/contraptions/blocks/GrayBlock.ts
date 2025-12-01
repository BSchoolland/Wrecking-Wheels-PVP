/**
 * Gray Block - high health defensive block
 */

import Matter from 'matter-js';
import { BaseBlock, AttachmentDirection, PhysicsSpawnResult, DamageType } from './BaseBlock';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';
import { PHYSICS_CONSTANTS } from '@shared/constants/physics';

export class GrayBlock extends BaseBlock {
  constructor(id: string, gridX: number, gridY: number) {
    super(id, 'gray', gridX, gridY);
    this.health = 100;
    this.damage = 4;
    this.energyCost = 0.4;
  }
  
  getSpritesheetName(): string | undefined {
    return 'blocks';
  }

  getSpriteRow(): number {
    return 4;
  }
  
  getAttachmentFaces(): AttachmentDirection[] {
    return ['top', 'right', 'bottom', 'left'];
  }
  
  static getBodySpecs() {
    return {
      0: {
        shape: 'rectangle' as const,
        width: BUILDER_CONSTANTS.BLOCK_SIZE,
        height: BUILDER_CONSTANTS.BLOCK_SIZE,
        options: {
          label: 'gray',
          density: PHYSICS_CONSTANTS.BLOCK_DENSITY,
          render: { fillStyle: '#757575', strokeStyle: '#000', lineWidth: 2 }
        }
      }
    };
  }

  createPhysicsBodies(worldX: number, worldY: number, _direction?: number): PhysicsSpawnResult {
    const body = Matter.Bodies.rectangle(
      worldX,
      worldY,
      BUILDER_CONSTANTS.BLOCK_SIZE,
      BUILDER_CONSTANTS.BLOCK_SIZE,
      { 
        label: this.id,
        density: PHYSICS_CONSTANTS.BLOCK_DENSITY,
        render: { fillStyle: '#757575', strokeStyle: '#000', lineWidth: 2 }
      }
    );
    
    return {
      bodies: [body],
      constraints: [],
      primaryBody: body,
    };
  }

  applyResistance(amount: number, type: DamageType): number {
    if (type === 'sharp') {
      return amount * 0.05;
    }
    if (type === 'blunt') {
      return amount * 0.1;
    }
    return amount;
  }
}

