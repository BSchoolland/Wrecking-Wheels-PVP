/**
 * Contraption class - manages blocks and physics assembly
 */

import Matter from 'matter-js';
import { Block, BlockData } from './Block';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';

export interface ContraptionSaveData {
  id: string;
  name: string;
  blocks: BlockData[];
}

export class Contraption {
  id: string;
  name: string;
  blocks: Map<string, Block>; // key: "x,y" grid position
  
  constructor(id: string = '', name: string = 'Unnamed Contraption') {
    this.id = id || `contraption-${Date.now()}`;
    this.name = name;
    this.blocks = new Map();
  }
  
  addBlock(block: Block): boolean {
    const key = `${block.gridX},${block.gridY}`;
    if (this.blocks.has(key)) {
      return false; // Cell already occupied
    }
    this.blocks.set(key, block);
    return true;
  }
  
  getBlock(gridX: number, gridY: number): Block | undefined {
    return this.blocks.get(`${gridX},${gridY}`);
  }
  
  getAllBlocks(): Block[] {
    return Array.from(this.blocks.values());
  }
  
  /**
   * Build physics bodies and constraints for this contraption
   */
  buildPhysics(startX: number, startY: number): { bodies: Matter.Body[], constraints: Matter.Constraint[] } {
    const bodies: Matter.Body[] = [];
    const constraints: Matter.Constraint[] = [];
    const bodyMap = new Map<string, Matter.Body>();
    
    const gridSize = BUILDER_CONSTANTS.GRID_SIZE;
    
    // Create bodies for each block
    this.blocks.forEach((block) => {
      const worldX = startX + block.gridX * gridSize;
      const worldY = startY + block.gridY * gridSize;
      
      if (block.type === 'wheel') {
        // Wheel is composite: attachment face + circle
        const attachmentFace = Matter.Bodies.rectangle(
          worldX,
          100, //   worldY - gridSize / 2 + BUILDER_CONSTANTS.WHEEL_ATTACHMENT_HEIGHT / 2,
          BUILDER_CONSTANTS.BLOCK_SIZE,
          BUILDER_CONSTANTS.WHEEL_ATTACHMENT_HEIGHT,
          { label: `${block.id}-attach` }
        );
        
        const wheel = Matter.Bodies.circle(
          worldX,
          worldY + BUILDER_CONSTANTS.WHEEL_RADIUS,
          BUILDER_CONSTANTS.WHEEL_RADIUS,
          { 
            friction: 0.8,
            label: `${block.id}-wheel`
          }
        );
        
        // Connect wheel to attachment face with revolute constraint (free spinning)
        const axle = Matter.Constraint.create({
          bodyA: attachmentFace,
          bodyB: wheel,
          pointA: { x: 0, y: BUILDER_CONSTANTS.WHEEL_ATTACHMENT_HEIGHT / 2 },
          pointB: { x: 0, y: 0 },
          length: 0,
          stiffness: 1,
        });
        
        bodies.push(attachmentFace, wheel);
        constraints.push(axle);
        bodyMap.set(`${block.gridX},${block.gridY}`, attachmentFace); // Use attachment face for connections
        
      } else {
        // Regular block (core or simple)
        const body = Matter.Bodies.rectangle(
          worldX,
          worldY,
          BUILDER_CONSTANTS.BLOCK_SIZE,
          BUILDER_CONSTANTS.BLOCK_SIZE,
          { label: block.id }
        );
        bodies.push(body);
        bodyMap.set(`${block.gridX},${block.gridY}`, body);
      }
    });
    
    // Create constraints between adjacent blocks
    this.blocks.forEach((block) => {
      const blockBody = bodyMap.get(`${block.gridX},${block.gridY}`);
      if (!blockBody) return;
      
      const faces = block.getAttachmentFaces();
      
      // Check each direction for neighbors
      if (faces.includes('right')) {
        const neighbor = this.getBlock(block.gridX + 1, block.gridY);
        if (neighbor && neighbor.getAttachmentFaces().includes('left')) {
          const neighborBody = bodyMap.get(`${neighbor.gridX},${neighbor.gridY}`);
          if (neighborBody) {
            // Two constraints: top corner and bottom corner of the shared edge
            const halfSize = gridSize / 2;
            
            // Top corner constraint
            constraints.push(Matter.Constraint.create({
              bodyA: blockBody,
              bodyB: neighborBody,
              pointA: { x: halfSize, y: -halfSize },
              pointB: { x: -halfSize, y: -halfSize },
              length: 0,
              stiffness: block.stiffness,
              damping: BUILDER_CONSTANTS.CONSTRAINT_DAMPING,
            }));
            
            // Bottom corner constraint
            constraints.push(Matter.Constraint.create({
              bodyA: blockBody,
              bodyB: neighborBody,
              pointA: { x: halfSize, y: halfSize },
              pointB: { x: -halfSize, y: halfSize },
              length: 0,
              stiffness: block.stiffness,
              damping: BUILDER_CONSTANTS.CONSTRAINT_DAMPING,
            }));
          }
        }
      }
      
      if (faces.includes('bottom')) {
        const neighbor = this.getBlock(block.gridX, block.gridY + 1);
        if (neighbor && neighbor.getAttachmentFaces().includes('top')) {
          const neighborBody = bodyMap.get(`${neighbor.gridX},${neighbor.gridY}`);
          if (neighborBody) {
            const halfSize = gridSize / 2;
            const neighborHalfY = neighbor.type === 'wheel'
              ? BUILDER_CONSTANTS.WHEEL_ATTACHMENT_HEIGHT / 2
              : halfSize;
            
            // Left corner constraint
            constraints.push(Matter.Constraint.create({
              bodyA: blockBody,
              bodyB: neighborBody,
              pointA: { x: -halfSize, y: halfSize },
              pointB: { x: -halfSize, y: -neighborHalfY },
              length: 0,
              stiffness: block.stiffness,
              damping: BUILDER_CONSTANTS.CONSTRAINT_DAMPING,
            }));
            
            // Right corner constraint
            constraints.push(Matter.Constraint.create({
              bodyA: blockBody,
              bodyB: neighborBody,
              pointA: { x: halfSize, y: halfSize },
              pointB: { x: halfSize, y: -neighborHalfY },
              length: 0,
              stiffness: block.stiffness,
              damping: BUILDER_CONSTANTS.CONSTRAINT_DAMPING,
            }));
          }
        }
      }
    });
    
    return { bodies, constraints };
  }
  
  /**
   * Save contraption to JSON
   */
  save(): ContraptionSaveData {
    return {
      id: this.id,
      name: this.name,
      blocks: this.getAllBlocks().map(b => b.toData()),
    };
  }
  
  /**
   * Load contraption from JSON
   */
  static load(data: ContraptionSaveData, blockFactory: (data: BlockData) => Block): Contraption {
    const contraption = new Contraption(data.id, data.name);
    data.blocks.forEach(blockData => {
      const block = blockFactory(blockData);
      contraption.addBlock(block);
    });
    return contraption;
  }
}

