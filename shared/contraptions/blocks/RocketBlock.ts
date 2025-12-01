/**
 * Rocket Block - attaches on the right, ignites on Shift after 500ms, thrusts forward
 */

import Matter from 'matter-js';
import { BaseBlock, AttachmentDirection, PhysicsSpawnResult } from './BaseBlock';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';
import { PHYSICS_CONSTANTS } from '@shared/constants/physics';
import { InputRegistry } from '@shared/input/InputSystem';

export class RocketBlock extends BaseBlock {
  static readonly INPUT_DELAY_MS = 250;
  static readonly BODY_WIDTH = BUILDER_CONSTANTS.BLOCK_SIZE;
  static readonly BODY_HEIGHT = BUILDER_CONSTANTS.BLOCK_SIZE;

  constructor(id: string, gridX: number, gridY: number) {
    super(id, 'rocket', gridX, gridY, 100);
    this.energyCost = 1;
  }

  getSpritesheetName(): string | undefined {
    return 'blocks';
  }

  getSpriteRow(): number {
    return 5;
  }

  // Rocket uses a 16x8 sprite (space for flame when active)
  getSpriteSize(): { width: number; height: number } {
    return { width: 16, height: 8 };
  }

  // Center the right half of the 16x8 sprite on the block (leave left half for flame)
  getSpriteOffset(): { x: number; y: number } {
    return { x: -16, y: 0 };
  }

  getAttachmentFaces(): AttachmentDirection[] {
    // Connects from the right
    return ['right'];
  }

  static getBodySpecs() {
    return {
      0: {
        shape: 'rectangle' as const,
        width: RocketBlock.BODY_WIDTH,
        height: RocketBlock.BODY_HEIGHT,
        options: {
          label: 'rocket',
          density: PHYSICS_CONSTANTS.BLOCK_DENSITY,
          chamfer: { radius: 6 },
          render: { fillStyle: '#c62828', strokeStyle: '#000', lineWidth: 2 }
        }
      }
    };
  }

  createPhysicsBodies(worldX: number, worldY: number, direction: number = 1): PhysicsSpawnResult {
    // Single rocket body
    const body = Matter.Bodies.rectangle(
      worldX,
      worldY,
      RocketBlock.BODY_WIDTH,
      RocketBlock.BODY_HEIGHT,
      {
        density: PHYSICS_CONSTANTS.BLOCK_DENSITY,
        chamfer: { radius: 6 },
        label: `${this.id}-rocket`,
        render: { fillStyle: '#c62828', strokeStyle: '#000', lineWidth: 2 },
      }
    );

    // Per-body tick: apply thrust while thrusting flag is true
    (body as unknown as { onTick?: () => void }).onTick = () => {
      const anyBody = body as unknown as { rocketThrusting?: boolean; physics?: { queueForce: (b: Matter.Body, f: Matter.Vector) => void } };
      if (anyBody.rocketThrusting) {
        // Forward in facing direction along the local +X axis
        const thrust = 0.01; // strong push per tick
        const cos = Math.cos(body.angle);
        const sin = Math.sin(body.angle);
        const fx = cos * thrust * direction;
        const fy = sin * thrust * direction;
        if (anyBody.physics) anyBody.physics.queueForce(body, { x: fx, y: fy });
      }
    };

    return {
      bodies: [body],
      constraints: [],
      primaryBody: body,
    };
  }
}

// Register input binding for rockets at module load
(() => {
  InputRegistry.register({
    id: 'rocket-hold',
    keys: ['Shift'],
    pressDelayMs: RocketBlock.INPUT_DELAY_MS,
    apply: (ctx, phase) => {
      const physics = ctx.physics;
      if (!physics) return;
      if (phase === 'press') {
        physics.setRocketHold(ctx.playerId, true);
      } else if (phase === 'release') {
        physics.setRocketHold(ctx.playerId, false);
      }
    }
  });
})();
