/**
 * Wheel Block - composite body with attachment face and rotating wheel
 */

import Matter from 'matter-js';
import { BaseBlock, AttachmentDirection, PhysicsSpawnResult } from './BaseBlock';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';
import { InputRegistry } from '@/game/input/InputSystem';

export class WheelBlock extends BaseBlock {
  // Public so builder UI can reference for rendering
  static readonly WHEEL_RADIUS = 12.5;
  static readonly ATTACHMENT_HEIGHT = 4;
  static readonly INPUT_DELAY_MS = 500;
  
  constructor(id: string, gridX: number, gridY: number) {
    super(id, 'wheel', gridX, gridY);
    this.energyCost = 0.5;
  }

  getSpritesheetName(): string | undefined {
    return 'blocks';
  }

  getSpriteRow(): number {
    return 2;
  }
  
  getSpriteOffset(): { x: number; y: number } {
    // Offset from attachment face (primary body) to wheel position
    // Wheel is below attachment face by: ATTACHMENT_HEIGHT + WHEEL_RADIUS - ATTACHMENT_HEIGHT/2
    const offsetY = (WheelBlock.ATTACHMENT_HEIGHT + WheelBlock.WHEEL_RADIUS - WheelBlock.ATTACHMENT_HEIGHT / 2) - 1;
    return { x: 0, y: offsetY };
  }
  
  getAttachmentFaces(): AttachmentDirection[] {
    return ['top'];
  }
  
  protected getConnectionHalfHeight(): number {
    return WheelBlock.ATTACHMENT_HEIGHT / 2;
  }
  
  createPhysicsBodies(worldX: number, worldY: number, direction: number = 1): PhysicsSpawnResult {
    // Use unique negative collision group per wheel so its parts don't collide with each other
    // while not affecting other wheels
    const group = Matter.Body.nextGroup(true);

    // Attachment face (top part that connects to other blocks)
    const attachmentFace = Matter.Bodies.rectangle(
      worldX,
      worldY - BUILDER_CONSTANTS.GRID_SIZE / 2 + WheelBlock.ATTACHMENT_HEIGHT / 2,
      BUILDER_CONSTANTS.BLOCK_SIZE,
      WheelBlock.ATTACHMENT_HEIGHT,
      { 
        label: `${this.id}-attach`,
        render: { fillStyle: '#795548', strokeStyle: '#000', lineWidth: 2 },
        collisionFilter: {
          group
        }
      }
    );
    (attachmentFace as unknown as { spriteRow?: number }).spriteRow = 2;
    
    // Wheel (circle that rolls)
    const wheel = Matter.Bodies.circle(
      worldX,
      worldY - BUILDER_CONSTANTS.GRID_SIZE / 2 + WheelBlock.ATTACHMENT_HEIGHT + WheelBlock.WHEEL_RADIUS,
      WheelBlock.WHEEL_RADIUS,
      { 
        friction: 0.8,
        label: `${this.id}-wheel`,
        render: { fillStyle: '#555', strokeStyle: '#000', lineWidth: 2 },
        collisionFilter: {
          group
        }
      }
    );
    (wheel as unknown as { spriteRow?: number }).spriteRow = 7;
    // Apply wheel drive based on per-body input set by physics (currentWheelInput)
    (wheel as unknown as { driveDir?: number }).driveDir = direction;
    (wheel as unknown as { onTick?: () => void }).onTick = () => {
      const anyWheel = wheel as unknown as { currentWheelInput?: number; angularVelocity?: number; torque?: number; driveDir?: number };
      const input = anyWheel.currentWheelInput || 0;
      if (!input) return;
      const driveDir = (anyWheel.driveDir ?? direction);
      const desired = 0.3 * input * driveDir * -1; // match prior speed
      const w = anyWheel.angularVelocity || 0;
      const needsAccel = (desired > 0 && w < desired) || (desired < 0 && w > desired);
      if (needsAccel) {
        const torque = 0.05 * (desired > 0 ? 1 : -1); // match prior torque
        anyWheel.torque = (anyWheel.torque || 0) + torque;
      }
    };
    
    // Connect wheel to attachment face with revolute constraint (free spinning)
    const axle = Matter.Constraint.create({
      bodyA: attachmentFace,
      bodyB: wheel,
      pointA: { x: 0, y: WheelBlock.ATTACHMENT_HEIGHT / 2 + WheelBlock.WHEEL_RADIUS },
      pointB: { x: 0, y: 0 },
      length: 0,
      stiffness: 1,
    });
    
    return {
      bodies: [attachmentFace, wheel],
      constraints: [axle],
      primaryBody: attachmentFace, // Use attachment face for connections
    };
  }
}

// Register input bindings for wheels at module load
(() => {
  InputRegistry.register({
    id: 'wheel-axis',
    keys: ['a', 'A', 'd', 'D'],
    pressDelayMs: WheelBlock.INPUT_DELAY_MS,
    apply: (ctx, phase, payload) => {
      const physics = ctx.physics;
      if (!physics) return;
      const value = phase === 'release' ? 0 : (typeof payload?.value === 'number' ? (payload.value as number) : 0);
      physics.setWheelInput(ctx.playerId, value);
    },
    onLocalVisual: (effects, playerId, phase, payload) => {
      const value = phase === 'release' ? 0 : (typeof payload?.value === 'number' ? (payload.value as number) : 0);
      if (value !== 0) {
        effects.startWheelGlow && effects.startWheelGlow(playerId);
      } else {
        effects.stopWheelGlow && effects.stopWheelGlow(playerId);
      }
    },
    makePayload: (e) => {
      const key = e.key;
      if (key === 'a' || key === 'A') return { value: 1 };
      if (key === 'd' || key === 'D') return { value: -1 };
      return undefined;
    }
  });
})();

