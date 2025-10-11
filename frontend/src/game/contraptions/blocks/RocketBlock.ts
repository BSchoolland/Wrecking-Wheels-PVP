/**
 * Rocket Block - attaches on the right, ignites on Shift after 500ms, thrusts forward
 */

import Matter from 'matter-js';
import { BaseBlock, AttachmentDirection, PhysicsSpawnResult } from './BaseBlock';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';
import { InputRegistry } from '@/game/input/InputSystem';

export class RocketBlock extends BaseBlock {
  static readonly INPUT_DELAY_MS = 500;
  static readonly BODY_WIDTH = BUILDER_CONSTANTS.BLOCK_SIZE;
  static readonly BODY_HEIGHT = BUILDER_CONSTANTS.BLOCK_SIZE;

  constructor(id: string, gridX: number, gridY: number) {
    super(id, 'rocket', gridX, gridY, 100);
    this.energyCost = 0.5;
  }

  getAttachmentFaces(): AttachmentDirection[] {
    // Connects from the right
    return ['right'];
  }

  createPhysicsBodies(worldX: number, worldY: number, direction: number = 1): PhysicsSpawnResult {
    const body = Matter.Bodies.rectangle(
      worldX,
      worldY,
      RocketBlock.BODY_WIDTH,
      RocketBlock.BODY_HEIGHT,
      {
        label: `${this.id}-rocket`,
        render: { fillStyle: '#c62828', strokeStyle: '#000', lineWidth: 2 },
      }
    );

    // Per-body tick: apply thrust if ignited
    (body as unknown as { onTick?: () => void }).onTick = () => {
      const anyBody = body as unknown as { rocketIgniteAt?: number; rocketThrusting?: boolean; physics?: { queueForce: (b: Matter.Body, f: Matter.Vector) => void } };
      const now = Date.now();
      if (anyBody.rocketIgniteAt && !anyBody.rocketThrusting && now >= anyBody.rocketIgniteAt) {
        anyBody.rocketThrusting = true;
      }
      if (anyBody.rocketThrusting) {
        console.log('rocket thrusting');
        // Forward in facing direction along the local +X axis
        const thrust = 0.015; // strong push per tick
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
        physics.igniteRocketsForPlayer(ctx.playerId);
        physics.setRocketHold(ctx.playerId, true);
      } else if (phase === 'release') {
        physics.setRocketHold(ctx.playerId, false);
      }
    }
  });
})();
