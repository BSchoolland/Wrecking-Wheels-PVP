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
  
  constructor(id: string, gridX: number, gridY: number) {
    super(id, 'wheel', gridX, gridY);
    this.materialCost = 0.25;
    this.energyCost = 0.25;
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
    // Simple motor: accelerate forward until target angular velocity
    (wheel as unknown as { onTick?: () => void }).onTick = () => {
      const TARGET_W_AVG = 0.3 * direction; // rad/s (direction determines spin direction)
      const MOTOR_TORQUE = 0.05 * direction; // torque matches direction
      if ((direction > 0 && wheel.angularVelocity < TARGET_W_AVG) || 
          (direction < 0 && wheel.angularVelocity > TARGET_W_AVG)) {
        (wheel as unknown as { torque?: number }).torque = ((wheel as unknown as { torque?: number }).torque || 0) + MOTOR_TORQUE;
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

