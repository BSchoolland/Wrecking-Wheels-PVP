/**
 * Contraptions module exports
 */

export { BaseBlock } from './blocks/BaseBlock';
export type { BlockData, AttachmentDirection, PhysicsSpawnResult } from './blocks/BaseBlock';

export { Contraption, setContraptionDebug, CONTRAPTION_DEBUG, setContraptionStaticDebug, CONTRAPTION_STATIC_DEBUG } from './Contraption';
export type { ContraptionSaveData } from './Contraption';

// Helper to create a block by type
import { BaseBlock } from './blocks/BaseBlock';
import { CoreBlock } from './blocks/CoreBlock';
import { SimpleBlock } from './blocks/SimpleBlock';
import { WheelBlock } from './blocks/WheelBlock';
import { SpikeBlock } from './blocks/SpikeBlock';
import { GrayBlock } from './blocks/GrayBlock';
import { TNTBlock } from './blocks/TNTBlock';
import { RocketBlock } from './blocks/RocketBlock';
import { HingeBlock } from './blocks/Hinge';

// Registry mapping type -> constructor; `BlockType` derives from keys
const BLOCK_REGISTRY = {
  core: CoreBlock,
  simple: SimpleBlock,
  wheel: WheelBlock,
  spike: SpikeBlock,
  gray: GrayBlock,
  tnt: TNTBlock,
  rocket: RocketBlock,
  hinge: HingeBlock,
} as const;

export type BlockType = keyof typeof BLOCK_REGISTRY;

// UI/Hotkey metadata for builder palette
export const BLOCK_METADATA: Readonly<Record<BlockType, { label: string; key: string }>> = {
  core: { label: 'Core', key: '1' },
  simple: { label: 'Simple', key: '2' },
  wheel: { label: 'Wheel', key: '3' },
  spike: { label: 'Spike', key: '4' },
  gray: { label: 'Gray', key: '5' },
  tnt: { label: 'TNT', key: '6' },
  rocket: { label: 'Rocket', key: '7' },
  hinge: { label: 'Hinge', key: '8' },
} as const;

// Ordered palette for consistent display
export const BLOCKS_ORDER: Readonly<BlockType[]> = [
  'core', 'simple', 'wheel', 'spike', 'gray', 'tnt', 'rocket', 'hinge'
] as const;

export function createBlock(type: BlockType, gridX: number, gridY: number): BaseBlock {
  const id = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const Ctor = BLOCK_REGISTRY[type];
  return new Ctor(id, gridX, gridY);
}

// Helper to reconstruct a block from saved data
import type { BlockData } from './blocks/BaseBlock';

export function blockFromData(data: BlockData): BaseBlock {
  const block = createBlock(data.type as BlockType, data.gridX, data.gridY);
  // Don't overwrite the unique ID from createBlock - keep it to avoid collisions between contraptions
  block.loadFromData(data);
  return block;
}
