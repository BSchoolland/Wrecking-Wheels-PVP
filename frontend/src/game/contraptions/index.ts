/**
 * Contraptions module exports
 */

export { BaseBlock } from './blocks/BaseBlock';
export type { BlockType, BlockData, AttachmentDirection, PhysicsSpawnResult } from './blocks/BaseBlock';
export { CoreBlock } from './blocks/CoreBlock';
export { SimpleBlock } from './blocks/SimpleBlock';
export { WheelBlock } from './blocks/WheelBlock';
export { Contraption } from './Contraption';
export type { ContraptionSaveData } from './Contraption';

// Helper to create a block by type
import { BaseBlock, BlockType } from './blocks/BaseBlock';
import { CoreBlock } from './blocks/CoreBlock';
import { SimpleBlock } from './blocks/SimpleBlock';
import { WheelBlock } from './blocks/WheelBlock';

export function createBlock(type: BlockType, gridX: number, gridY: number): BaseBlock {
  const id = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  switch (type) {
    case 'core':
      return new CoreBlock(id, gridX, gridY);
    case 'simple':
      return new SimpleBlock(id, gridX, gridY);
    case 'wheel':
      return new WheelBlock(id, gridX, gridY);
    default:
      throw new Error(`Unknown block type: ${type}`);
  }
}

// Helper to reconstruct a block from saved data
import type { BlockData } from './blocks/BaseBlock';

export function blockFromData(data: BlockData): BaseBlock {
  switch (data.type) {
    case 'core':
      const core = new CoreBlock(data.id, data.gridX, data.gridY);
      core.health = data.health;
      core.stiffness = data.stiffness;
      return core;
    case 'simple':
      const simple = new SimpleBlock(data.id, data.gridX, data.gridY);
      simple.health = data.health;
      simple.stiffness = data.stiffness;
      return simple;
    case 'wheel':
      const wheel = new WheelBlock(data.id, data.gridX, data.gridY);
      wheel.health = data.health;
      wheel.stiffness = data.stiffness;
      return wheel;
  }
}
