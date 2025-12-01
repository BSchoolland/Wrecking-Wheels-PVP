/**
 * Hinge Block - composite body with attachment faces and rotating hinge
 */

import Matter from 'matter-js';
import { BaseBlock, AttachmentDirection, PhysicsSpawnResult } from './BaseBlock';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';
import { PHYSICS_CONSTANTS } from '@shared/constants/physics';
import { InputRegistry } from '@/game/input/InputSystem';

export class HingeBlock extends BaseBlock {
  // Public so builder UI can reference for rendering
  static readonly HINGE_RADIUS = 8;
  static readonly ATTACHMENT_HEIGHT = 8;
  static readonly INPUT_DELAY_MS = 500;
  
  // Store bodies for attachment face lookup
  private attachmentFaceTopBody: Matter.Body | undefined;
  private attachmentFaceBottomBody: Matter.Body | undefined;
  private angleConstraintMirrored: Matter.Constraint | null = null;
  // Rotation state properties
  private currentAngle: number = 0;
  private readonly maxAngle: number = Math.PI / 2; // ±90 degrees
  private readonly rotationSpeed: number = 0.03;
  private rotationDirection: number = 1;
  private angleConstraint: Matter.Constraint | null = null;
  private hingeBody: Matter.Body | undefined;
  // Static per-player input state, controlled by Q/E bindings
  private static playerInput: Map<string, number> = new Map();
  static setPlayerInput(playerId: string, value: number): void {
    const v = Math.max(-1, Math.min(1, value));
    if (v === 0) HingeBlock.playerInput.delete(playerId); else HingeBlock.playerInput.set(playerId, v);
  }
  static clearPlayerInput(playerId: string): void {
    HingeBlock.playerInput.delete(playerId);
  }
  static getPlayerInput(playerId: string | undefined): number {
    if (!playerId) return 0;
    return HingeBlock.playerInput.get(playerId) || 0;
  }
  
  constructor(id: string, gridX: number, gridY: number) {
    super(id, 'hinge', gridX, gridY);
    this.energyCost = 0.8;
  }

  getSpritesheetName(): string | undefined {
    return 'blocks';
  }

  getSpriteRow(): number {
    return 2;
  }
  
  getSpriteOffset(): { x: number; y: number } {
    // Offset from attachment face (primary body) to hinge position
    // Wheel is below attachment face by: ATTACHMENT_HEIGHT + HINGE_RADIUS - ATTACHMENT_HEIGHT/2
    const offsetY = (HingeBlock.ATTACHMENT_HEIGHT + HingeBlock.HINGE_RADIUS - HingeBlock.ATTACHMENT_HEIGHT / 2) - 1;
    return { x: 0, y: offsetY };
  }
  
  getAttachmentFaces(): AttachmentDirection[] {
    return ['top', 'bottom'];
  }

  getBodyForAttachmentFace(face: AttachmentDirection): Matter.Body | undefined {
    // Map the rotated face back to the unrotated local face to get the correct body
    const localFace = this.getUnrotatedFace(face);
    if (localFace === 'top') {
      return this.attachmentFaceTopBody;
    } else if (localFace === 'bottom') {
      return this.attachmentFaceBottomBody;
    }
    return undefined;
  }
  
  protected getConnectionHalfHeight(): number {
    return HingeBlock.ATTACHMENT_HEIGHT / 2;
  }

  static getBodySpecs() {
    return {
      0: {
        shape: 'rectangle' as const,
        width: BUILDER_CONSTANTS.BLOCK_SIZE,
        height: HingeBlock.ATTACHMENT_HEIGHT,
        options: {
          label: 'hinge-attach-top',
          density: PHYSICS_CONSTANTS.BLOCK_DENSITY,
          render: { fillStyle: '#795548', strokeStyle: '#000', lineWidth: 2 }
        }
      },
      1: {
        shape: 'rectangle' as const,
        width: BUILDER_CONSTANTS.BLOCK_SIZE,
        height: HingeBlock.ATTACHMENT_HEIGHT,
        options: {
          label: 'hinge-attach-bottom',
          density: PHYSICS_CONSTANTS.BLOCK_DENSITY,
          render: { fillStyle: '#795548', strokeStyle: '#000', lineWidth: 2 }
        }
      },
      2: {
        shape: 'circle' as const,
        radius: HingeBlock.HINGE_RADIUS,
        options: {
          label: 'hinge-circle',
          friction: 0.8,
          density: PHYSICS_CONSTANTS.BLOCK_DENSITY,
          render: { fillStyle: '#555', strokeStyle: '#000', lineWidth: 2 }
        }
      }
    };
  }

  private getUnrotatedFace(face: AttachmentDirection): AttachmentDirection {
    // Map the rotated face back to the unrotated local face
    if (this.ignoreRotation) return face;
    const steps = this.getRotationSteps();
    const order: AttachmentDirection[] = ['top', 'right', 'bottom', 'left'];
    return order[(order.indexOf(face) - steps + 400) % 4];
  }
  
  createPhysicsBodies(worldX: number, worldY: number, _direction: number = 1): PhysicsSpawnResult {
    // Use unique negative collision group per wheel so its parts don't collide with each other
    // while not affecting other wheels
    const group = Matter.Body.nextGroup(true);

    // Attachment face (top part that connects to other blocks)
    const attachmentFaceTop = Matter.Bodies.rectangle(
      worldX,
      worldY - BUILDER_CONSTANTS.GRID_SIZE / 2 + HingeBlock.ATTACHMENT_HEIGHT / 2,
      BUILDER_CONSTANTS.BLOCK_SIZE,
      HingeBlock.ATTACHMENT_HEIGHT,
      { 
        label: `${this.id}-attach`,
        density: PHYSICS_CONSTANTS.BLOCK_DENSITY,
        render: { fillStyle: '#795548', strokeStyle: '#000', lineWidth: 2 },
        collisionFilter: {
          group
        }
      }
    );
    (attachmentFaceTop as unknown as { spriteRow?: number }).spriteRow = 2;
    this.attachmentFaceTopBody = attachmentFaceTop;

    // Attachment face (bottom part that connects to other blocks)
    const attachmentFaceBottom = Matter.Bodies.rectangle(
      worldX,
      worldY + BUILDER_CONSTANTS.GRID_SIZE / 2 - HingeBlock.ATTACHMENT_HEIGHT / 2,
      BUILDER_CONSTANTS.BLOCK_SIZE,
      HingeBlock.ATTACHMENT_HEIGHT,
      { 
        label: `${this.id}-attach-bottom`,
        density: PHYSICS_CONSTANTS.BLOCK_DENSITY,
        render: { fillStyle: '#795548', strokeStyle: '#000', lineWidth: 2 },
        collisionFilter: {
          group
        }
      }
    );
    (attachmentFaceBottom as unknown as { spriteRow?: number }).spriteRow = 2;
    (attachmentFaceBottom as unknown as { flipY?: boolean }).flipY = true;
    // Store sprite offsets per-body (bottom attachment offset is inverted)
    const spriteOffset = this.getSpriteOffset();
    (attachmentFaceTop as unknown as { spriteOffsetX?: number }).spriteOffsetX = spriteOffset.x;
    (attachmentFaceTop as unknown as { spriteOffsetY?: number }).spriteOffsetY = spriteOffset.y;
    (attachmentFaceBottom as unknown as { spriteOffsetX?: number }).spriteOffsetX = spriteOffset.x;
    (attachmentFaceBottom as unknown as { spriteOffsetY?: number }).spriteOffsetY = -spriteOffset.y;
    this.attachmentFaceBottomBody = attachmentFaceBottom;

    // Hinge center (circle that spins)
    const hingeBody = Matter.Bodies.circle(
      worldX,
      worldY - BUILDER_CONSTANTS.GRID_SIZE / 2 + HingeBlock.ATTACHMENT_HEIGHT + HingeBlock.HINGE_RADIUS,
      HingeBlock.HINGE_RADIUS,
      { 
        friction: 0.8,
        density: PHYSICS_CONSTANTS.BLOCK_DENSITY,
        label: `${this.id}-hinge`,
        render: { fillStyle: '#555', strokeStyle: '#000', lineWidth: 2 },
        collisionFilter: {
          group
        }
      }
    );
    (hingeBody as unknown as { spriteRow?: number }).spriteRow = 8;

    this.hingeBody = hingeBody;
    // Per-tick: read input from HingeBlock static map by ownerId and rotate
    (hingeBody as unknown as { onTick?: () => void }).onTick = () => {
      const ownerId = (hingeBody as unknown as { ownerId?: string }).ownerId;
      const input = HingeBlock.getPlayerInput(ownerId);
      this.update(input);
    };
    
    // Rigid connection from top to hinge
    const topAxle = Matter.Constraint.create({
      bodyA: attachmentFaceTop,
      bodyB: hingeBody,
      pointA: { x: 0, y: HingeBlock.ATTACHMENT_HEIGHT / 2 + HingeBlock.HINGE_RADIUS },
      pointB: { x: 0, y: 0 },
      length: 0,
      stiffness: 1,
    });

    // Second rigid connection from bottom to hinge (keeps it attached)
    const bottomToHingeAxle = Matter.Constraint.create({
      bodyA: attachmentFaceBottom,
      bodyB: hingeBody,
      pointA: { x: 0, y: -(HingeBlock.ATTACHMENT_HEIGHT / 2 + HingeBlock.HINGE_RADIUS) },
      pointB: { x: 0, y: 0 },
      length: 0,
      stiffness: 1,
    });

    // Constraint from top face center to bottom face - this one moves
    // Both anchors start at the same world position (top face center)
    const distance = BUILDER_CONSTANTS.GRID_SIZE - HingeBlock.ATTACHMENT_HEIGHT;
    const rotationConstraint = Matter.Constraint.create({
      bodyA: attachmentFaceTop,
      bodyB: attachmentFaceBottom,
      pointA: { x: 0, y: 0 }, // Center of top face
      pointB: { x: 0, y: -distance }, // Offset from bottom face center to top face center
      length: 0,
      stiffness: 1,
      render: { strokeStyle: '#ff0000', lineWidth: 2 }
    });
    this.angleConstraint = rotationConstraint;

    const rotationConstraintMirrored = Matter.Constraint.create({
      bodyA: attachmentFaceBottom,
      bodyB: attachmentFaceTop,
      pointA: { x: 0, y: 0 }, // Center of top face
      pointB: { x: 0, y: distance }, // Offset from bottom face center to top face center
      length: 0,
      stiffness: 1,
      render: { strokeStyle: '#ff0000', lineWidth: 2 }
    });

    this.angleConstraintMirrored = rotationConstraintMirrored;

    return {
      bodies: [attachmentFaceTop, attachmentFaceBottom, hingeBody],
      constraints: [topAxle, bottomToHingeAxle, rotationConstraint, rotationConstraintMirrored],
      primaryBody: attachmentFaceTop, // Use attachment face for connections
    };
  }
  
  // Handle rotation input
  update(input: number): void {
    if (!this.angleConstraint || !this.attachmentFaceTopBody) return;
    
    if (input !== 0) {
      this.rotate(input === -1);
    }
  }
  
  private rotate(reverse: boolean = false): void {
    if (!this.angleConstraint || !this.attachmentFaceBottomBody) return;
    
    this.rotationDirection = reverse ? -1 : 1;
    this.currentAngle += this.rotationSpeed * this.rotationDirection;
    
    // Clamp angle within bounds
    this.currentAngle = Math.max(-this.maxAngle, Math.min(this.maxAngle, this.currentAngle));
    
    // Calculate constraint point in local space
    // Follow a circle centered at (0, -distance/2) with radius distance/2
    // So: at 0° -> (0, -distance), at 90° -> (distance/2, -distance/2), at 180° -> (0, 0)
    const distance = BUILDER_CONSTANTS.GRID_SIZE - HingeBlock.ATTACHMENT_HEIGHT;
    const r = distance / 2;
    const x = r * Math.sin(this.currentAngle);
    const y = -(distance / 2) - r * Math.cos(this.currentAngle);
    
    // Rotate vector by the attachment face body's current rotation
    const bodyAngle = this.attachmentFaceBottomBody.angle;
    const cos = Math.cos(bodyAngle);
    const sin = Math.sin(bodyAngle);
    const rotatedX = x * cos - y * sin;
    const rotatedY = x * sin + y * cos;
    
    this.angleConstraint.pointB = {
      x: rotatedX,
      y: rotatedY
    };
    this.angleConstraintMirrored.pointB = {
      x: -rotatedX,
      y: -rotatedY
    };
  }
  
  reset(): void {
    this.currentAngle = 0;
    if (this.angleConstraint) {
      const distance = BUILDER_CONSTANTS.GRID_SIZE - HingeBlock.ATTACHMENT_HEIGHT;
      this.angleConstraint.pointB = { x: 0, y: -distance };
    }
  }
}

// Register input bindings for hinges at module load
(() => {
  InputRegistry.register({
    id: 'hinge-axis',
    keys: ['q', 'Q', 'e', 'E'],
    pressDelayMs: HingeBlock.INPUT_DELAY_MS,
    apply: (ctx, phase, payload) => {
      const value = phase === 'release' ? 0 : (typeof payload?.value === 'number' ? (payload.value as number) : 0);
      if (value === 0) HingeBlock.clearPlayerInput(ctx.playerId); else HingeBlock.setPlayerInput(ctx.playerId, value);
    },
    onLocalVisual: (_effects, _playerId, _phase, _payload) => {
      // No local visuals for hinge yet
    },
    makePayload: (e) => {
      const key = e.key;
      if (key === 'q' || key === 'Q') return { value: -1 };
      if (key === 'e' || key === 'E') return { value: 1 };
      return undefined;
    }
  });
})();