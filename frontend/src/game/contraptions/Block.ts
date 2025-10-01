/**
 * Base Block class and block types
 */

import { BUILDER_CONSTANTS } from '@shared/constants/builder';

export type BlockType = 'core' | 'simple' | 'wheel';
export type AttachmentDirection = 'top' | 'right' | 'bottom' | 'left';

export interface BlockData {
  id: string;
  type: BlockType;
  gridX: number;
  gridY: number;
  health: number;
  stiffness: number; // Affects constraint strength
}

export abstract class Block {
  id: string;
  type: BlockType;
  gridX: number;
  gridY: number;
  health: number;
  stiffness: number;
  
  constructor(id: string, type: BlockType, gridX: number, gridY: number) {
    this.id = id;
    this.type = type;
    this.gridX = gridX;
    this.gridY = gridY;
    this.health = 100;
    this.stiffness = BUILDER_CONSTANTS.ATTACHMENT_STIFFNESS;
  }
  
  abstract getAttachmentFaces(): AttachmentDirection[];
  
  toData(): BlockData {
    return {
      id: this.id,
      type: this.type,
      gridX: this.gridX,
      gridY: this.gridY,
      health: this.health,
      stiffness: this.stiffness,
    };
  }
}

export class CoreBlock extends Block {
  constructor(id: string, gridX: number, gridY: number) {
    super(id, 'core', gridX, gridY);
  }
  
  getAttachmentFaces(): AttachmentDirection[] {
    return ['top', 'right', 'bottom', 'left'];
  }
}

export class SimpleBlock extends Block {
  constructor(id: string, gridX: number, gridY: number) {
    super(id, 'simple', gridX, gridY);
  }
  
  getAttachmentFaces(): AttachmentDirection[] {
    return ['top', 'right', 'bottom', 'left'];
  }
}

export class WheelBlock extends Block {
  constructor(id: string, gridX: number, gridY: number) {
    super(id, 'wheel', gridX, gridY);
  }
  
  getAttachmentFaces(): AttachmentDirection[] {
    return ['top'];
  }
}

export function createBlock(type: BlockType, gridX: number, gridY: number): Block {
  const id = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  switch (type) {
    case 'core':
      return new CoreBlock(id, gridX, gridY);
    case 'simple':
      return new SimpleBlock(id, gridX, gridY);
    case 'wheel':
      return new WheelBlock(id, gridX, gridY);
  }
}

