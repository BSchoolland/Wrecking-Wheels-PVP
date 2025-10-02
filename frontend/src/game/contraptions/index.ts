/**
 * Contraptions module exports
 */

export { BaseBlock } from './blocks/BaseBlock';
export type { BlockType, BlockData, AttachmentDirection, PhysicsSpawnResult } from './blocks/BaseBlock';
export { CoreBlock } from './blocks/CoreBlock';
export { SimpleBlock } from './blocks/SimpleBlock';
export { WheelBlock } from './blocks/WheelBlock';
export { SpikeBlock } from './blocks/SpikeBlock';
export { GrayBlock } from './blocks/GrayBlock';
export { Contraption } from './Contraption';
export type { ContraptionSaveData } from './Contraption';

// Helper to create a block by type
import { BaseBlock, BlockType } from './blocks/BaseBlock';
import { CoreBlock } from './blocks/CoreBlock';
import { SimpleBlock } from './blocks/SimpleBlock';
import { WheelBlock } from './blocks/WheelBlock';
import { SpikeBlock } from './blocks/SpikeBlock';
import { GrayBlock } from './blocks/GrayBlock';

export function createBlock(type: BlockType, gridX: number, gridY: number): BaseBlock {
  const id = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  switch (type) {
    case 'core':
      return new CoreBlock(id, gridX, gridY);
    case 'simple':
      return new SimpleBlock(id, gridX, gridY);
    case 'wheel':
      return new WheelBlock(id, gridX, gridY);
    case 'spike':
      return new SpikeBlock(id, gridX, gridY);
    case 'gray':
      return new GrayBlock(id, gridX, gridY);
    default:
      throw new Error(`Unknown block type: ${type}`);
  }
}

// Helper to reconstruct a block from saved data
import type { BlockData } from './blocks/BaseBlock';

export function blockFromData(data: BlockData): BaseBlock {
  switch (data.type) {
    case 'core': {
      const core = new CoreBlock(data.id, data.gridX, data.gridY);
      core.maxHealth = data.maxHealth ?? 100;
      core.health = data.health;
      core.stiffness = data.stiffness;
      if (data.damage !== undefined) core.damage = data.damage;
      if (data.knockback !== undefined) core.knockback = data.knockback;
      return core;
    }
    case 'simple': {
      const simple = new SimpleBlock(data.id, data.gridX, data.gridY);
      simple.maxHealth = data.maxHealth ?? 100;
      simple.health = data.health;
      simple.stiffness = data.stiffness;
      if (data.damage !== undefined) simple.damage = data.damage;
      if (data.knockback !== undefined) simple.knockback = data.knockback;
      return simple;
    }
    case 'wheel': {
      const wheel = new WheelBlock(data.id, data.gridX, data.gridY);
      wheel.health = data.health;
      wheel.stiffness = data.stiffness;
      if (data.damage !== undefined) wheel.damage = data.damage;
      if (data.knockback !== undefined) wheel.knockback = data.knockback;
      return wheel;
    }
    case 'spike': {
      const spike = new SpikeBlock(data.id, data.gridX, data.gridY);
      spike.maxHealth = data.maxHealth ?? 1000;
      spike.health = data.health;
      spike.stiffness = data.stiffness;
      if (data.damage !== undefined) spike.damage = data.damage;
      if (data.knockback !== undefined) spike.knockback = data.knockback;
      return spike;
    }
    case 'gray': {
      const gray = new GrayBlock(data.id, data.gridX, data.gridY);
      gray.health = data.health;
      gray.stiffness = data.stiffness;
      if (data.damage !== undefined) gray.damage = data.damage;
      if (data.knockback !== undefined) gray.knockback = data.knockback;
      return gray;
    }
    default:
      throw new Error(`Unknown block type: ${data.type}`);
  }
}
