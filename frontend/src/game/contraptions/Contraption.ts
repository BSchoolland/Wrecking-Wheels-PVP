/**
 * Contraption class - manages blocks and orchestrates physics assembly
 */

import Matter from 'matter-js';
import { BaseBlock } from './blocks/BaseBlock';
import type { BlockData, AttachmentDirection } from './blocks/BaseBlock';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';

export interface ContraptionSaveData {
  id: string;
  name: string;
  blocks: BlockData[];
  direction?: number; // 1 = right (default), -1 = left (mirrored)
  team?: string; // Team identifier for friendly fire prevention
}

export class Contraption {
  id: string;
  name: string;
  blocks: Map<string, BaseBlock>; // key: "x,y" grid position
  direction: number; // 1 = right (default), -1 = left (mirrored)
  team: string; // Team identifier for friendly fire prevention
  
  constructor(id: string = '', name: string = 'Unnamed Contraption', direction: number = 1, team: string = 'default') {
    this.id = id || `contraption-${Date.now()}`;
    this.name = name;
    this.direction = direction;
    this.team = team;
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
  
  hasCore(): boolean {
    return this.getAllBlocks().some(b => b.type === 'core');
  }
  
  findCore(): BaseBlock | undefined {
    return this.getAllBlocks().find(b => b.type === 'core');
  }
  
  getCost(): { energy: number } {
    const blocks = this.getAllBlocks();
    const totalEnergy = blocks.reduce((sum, b) => sum + b.energyCost, 0);
    return {
      energy: Math.ceil(Number(totalEnergy.toFixed(2))),
    };
  }
  
  removeBlockAt(gridX: number, gridY: number): void {
    for (const [key, block] of this.blocks.entries()) {
      if (block.gridX === gridX && block.gridY === gridY) {
        this.blocks.delete(key);
        return;
      }
    }
  }
  
  /**
   * Check connectivity using BFS pathfinding.
   * Blocks not connected to the core have their health set to 0.
   */
  checkConnectivity(): void {
    const core = this.findCore();
    if (!core || core.health <= 0) {
      // No core or dead core - all blocks die
      this.getAllBlocks().forEach(b => b.health = 0);
      return;
    }
    
    const connected = new Set<string>();
    const queue: BaseBlock[] = [core];
    connected.add(`${core.gridX},${core.gridY}`);
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      const faces = current.getAttachmentFaces();
      
      // Check all adjacent blocks
      const neighbors: Array<{ dx: number; dy: number; face: string; opposite: string }> = [
        { dx: 0, dy: -1, face: 'top', opposite: 'bottom' },
        { dx: 1, dy: 0, face: 'right', opposite: 'left' },
        { dx: 0, dy: 1, face: 'bottom', opposite: 'top' },
        { dx: -1, dy: 0, face: 'left', opposite: 'right' },
      ];
      
      for (const { dx, dy, face, opposite } of neighbors) {
        if (!faces.includes(face as AttachmentDirection)) continue;
        
        const neighbor = this.getBlock(current.gridX + dx, current.gridY + dy);
        const key = `${current.gridX + dx},${current.gridY + dy}`;
        
        if (neighbor && neighbor.health > 0 && !connected.has(key) && neighbor.getAttachmentFaces().includes(opposite as AttachmentDirection)) {
          connected.add(key);
          queue.push(neighbor);
        }
      }
    }
    
    // Set health to 0 for disconnected blocks
    this.getAllBlocks().forEach(block => {
      const key = `${block.gridX},${block.gridY}`;
      if (!connected.has(key) && block.health > 0) {
        block.health = 0;
      }
    });
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
    
    // Revive all blocks and check connectivity once on spawn
    this.blocks.forEach(block => {
      if (block.health <= 0) block.health = 100;
    });
    this.checkConnectivity();
    
    // Create bodies for each block by calling block's method
    this.blocks.forEach((block) => {
      const worldX = startX + block.gridX * gridSize * this.direction;
      const worldY = startY + block.gridY * gridSize;

      const result = block.createPhysicsBodies(worldX, worldY, this.direction);
      
      // Tag all bodies with contraption ID, team, and block reference
      result.bodies.forEach(body => {
        (body as unknown as { contraptionId?: string }).contraptionId = this.id;
        (body as unknown as { team?: string }).team = this.team;
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
      team: this.team,
    };
  }
  
  /**
   * Load contraption from JSON
   */
  static load(data: ContraptionSaveData, blockFactory: (data: BlockData) => BaseBlock): Contraption {
    const contraption = new Contraption(data.id, data.name, data.direction ?? 1, data.team ?? 'default');
    data.blocks.forEach(blockData => {
      const block = blockFactory(blockData);
      contraption.addBlock(block);
    });
    return contraption;
  }
}
