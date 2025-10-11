/**
 * Wheel Block - composite body with attachment face and rotating wheel
 */

import Matter from 'matter-js';
import { BaseBlock, AttachmentDirection, PhysicsSpawnResult } from './BaseBlock';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';

export class WheelBlock extends BaseBlock {
  // Public so builder UI can reference for rendering
  static readonly WHEEL_RADIUS = 12.5;
  static readonly ATTACHMENT_HEIGHT = 4;
  static readonly INPUT_DELAY_MS = 500;
  
  constructor(id: string, gridX: number, gridY: number) {
    super(id, 'wheel', gridX, gridY);
    this.energyCost = 0.5;
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

