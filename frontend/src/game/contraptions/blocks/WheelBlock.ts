/**
 * Wheel Block - composite body with attachment face and rotating wheel
 */

import Matter from 'matter-js';
import { BaseBlock, AttachmentDirection, PhysicsSpawnResult } from './BaseBlock';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';

export class WheelBlock extends BaseBlock {
  // Public so builder UI can reference for rendering
  static readonly WHEEL_RADIUS = 12.5;
  static readonly ATTACHMENT_HEIGHT = 15;
  
  constructor(id: string, gridX: number, gridY: number) {
    super(id, 'wheel', gridX, gridY);
  }
  
  getAttachmentFaces(): AttachmentDirection[] {
    return ['top'];
  }
  
  protected getConnectionHalfHeight(): number {
    return WheelBlock.ATTACHMENT_HEIGHT / 2;
  }
  
  createPhysicsBodies(worldX: number, worldY: number): PhysicsSpawnResult {
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
        collisionFilter: {
          group
        }
      }
    );
    
    // Connect wheel to attachment face with revolute constraint (free spinning)
    const axle = Matter.Constraint.create({
      bodyA: attachmentFace,
      bodyB: wheel,
      pointA: { x: 0, y: WheelBlock.ATTACHMENT_HEIGHT / 2 },
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

