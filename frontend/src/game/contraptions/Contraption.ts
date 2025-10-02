/**
 * Contraption class - manages blocks and orchestrates physics assembly
 */

import Matter from 'matter-js';
import { BaseBlock } from './blocks/BaseBlock';
import type { BlockData } from './blocks/BaseBlock';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';

export interface ContraptionSaveData {
  id: string;
  name: string;
  blocks: BlockData[];
  direction?: number; // 1 = right (default), -1 = left (mirrored)
}

export class Contraption {
  id: string;
  name: string;
  blocks: Map<string, BaseBlock>; // key: "x,y" grid position
  direction: number; // 1 = right (default), -1 = left (mirrored)
  
  constructor(id: string = '', name: string = 'Unnamed Contraption', direction: number = 1) {
    this.id = id || `contraption-${Date.now()}`;
    this.name = name;
    this.direction = direction;
    this.blocks = new Map();
  }
  
  addBlock(block: BaseBlock): boolean {
    const key = `${block.gridX},${block.gridY}`;
    if (this.blocks.has(key)) {
      return false; // Cell already occupied
    }
    this.blocks.set(key, block);
    return true;
  }
  
  getBlock(gridX: number, gridY: number): BaseBlock | undefined {
    return this.blocks.get(`${gridX},${gridY}`);
  }
  
  getAllBlocks(): BaseBlock[] {
    return Array.from(this.blocks.values());
  }
  
  /**
   * Build physics bodies and constraints for this contraption
   * Orchestrates block spawning by calling methods on each block
   */
  buildPhysics(startX: number, startY: number): { bodies: Matter.Body[], constraints: Matter.Constraint[] } {
    const bodies: Matter.Body[] = [];
    const constraints: Matter.Constraint[] = [];
    const bodyMap = new Map<string, Matter.Body>();
    
    const gridSize = BUILDER_CONSTANTS.GRID_SIZE;
    
    // Create bodies for each block by calling block's method
    this.blocks.forEach((block) => {
      const worldX = startX + block.gridX * gridSize * this.direction;
      const worldY = startY + block.gridY * gridSize;
      
      // Revive destroyed blocks for a fresh spawn
      if (block.health <= 0) block.health = 100;

      const result = block.createPhysicsBodies(worldX, worldY, this.direction);
      
      // Tag all bodies with contraption ID and block reference
      result.bodies.forEach(body => {
        (body as unknown as { contraptionId?: string }).contraptionId = this.id;
        (body as unknown as { blockId?: string }).blockId = block.id;
        (body as unknown as { block?: BaseBlock }).block = block;
        // Attach generic collision handler for damage/knockback
        (body as unknown as { onCollision?: (myBody: Matter.Body, otherBody: Matter.Body) => void }).onCollision =
          (myBody: Matter.Body, otherBody: Matter.Body) => block.onCollision(myBody, otherBody);
      });
      
      bodies.push(...result.bodies);
      constraints.push(...result.constraints);
      bodyMap.set(`${block.gridX},${block.gridY}`, result.primaryBody);
    });
    
    // Create constraints between adjacent blocks by calling block's method
    this.blocks.forEach((block) => {
      const blockBody = bodyMap.get(`${block.gridX},${block.gridY}`);
      if (!blockBody) return;
      
      const faces = block.getAttachmentFaces();
      
      // Check right neighbor
      if (faces.includes('right')) {
        const neighbor = this.getBlock(block.gridX + 1, block.gridY);
        if (neighbor && neighbor.getAttachmentFaces().includes('left')) {
          const neighborBody = bodyMap.get(`${neighbor.gridX},${neighbor.gridY}`);
          if (neighborBody) {
            const connectionConstraints = block.createConnectionConstraints('right', blockBody, neighborBody, neighbor, this.direction);
            constraints.push(...connectionConstraints);
          }
        }
      }
      
      // Check bottom neighbor
      if (faces.includes('bottom')) {
        const neighbor = this.getBlock(block.gridX, block.gridY + 1);
        if (neighbor && neighbor.getAttachmentFaces().includes('top')) {
          const neighborBody = bodyMap.get(`${neighbor.gridX},${neighbor.gridY}`);
          if (neighborBody) {
            const connectionConstraints = block.createConnectionConstraints('bottom', blockBody, neighborBody, neighbor, this.direction);
            constraints.push(...connectionConstraints);
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
      direction: this.direction,
    };
  }
  
  /**
   * Load contraption from JSON
   */
  static load(data: ContraptionSaveData, blockFactory: (data: BlockData) => BaseBlock): Contraption {
    const contraption = new Contraption(data.id, data.name, data.direction ?? 1);
    data.blocks.forEach(blockData => {
      const block = blockFactory(blockData);
      contraption.addBlock(block);
    });
    return contraption;
  }
}
