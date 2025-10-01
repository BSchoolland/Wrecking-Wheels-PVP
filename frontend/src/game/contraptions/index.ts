/**
 * Contraptions module exports
 */

export { Block, createBlock, CoreBlock, SimpleBlock, WheelBlock } from './Block';
export type { BlockType, BlockData } from './Block';
export { Contraption } from './Contraption';
export type { ContraptionSaveData } from './Contraption';

// Helper to reconstruct a block from saved data
import { Block, BlockData, CoreBlock, SimpleBlock, WheelBlock } from './Block';

export function blockFromData(data: BlockData): Block {
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

