/**
 * Input System - Shared registry for block input bindings
 * The InputController (browser-specific) remains in frontend
 */

export type InputPhase = 'press' | 'release' | 'change';

export interface BlockInputPayload {
  [key: string]: unknown;
}

export interface BlockInputContext {
  role: 'host' | 'client';
  playerId: string;
  physics?: {
    setWheelInput: (playerId: string, value: number) => void;
    setRocketHold: (playerId: string, value: boolean) => void;
  } | null;
}

export interface BlockInputBinding {
  id: string;
  keys?: string[];
  pressDelayMs?: number;
  releaseDelayMs?: number;
  makePayload?: (e: unknown, phase: InputPhase, localState: Record<string, unknown>) => BlockInputPayload | undefined;
  apply: (ctx: BlockInputContext, phase: InputPhase, payload?: BlockInputPayload) => void;
  onLocalVisual?: (effects: { startWheelGlow?: (playerId: string) => void; stopWheelGlow?: (playerId: string) => void }, playerId: string, phase: InputPhase, payload?: BlockInputPayload) => void;
}

class InputRegistryImpl {
  private bindings: Map<string, BlockInputBinding> = new Map();
  private keyToBindings: Map<string, BlockInputBinding[]> = new Map();

  register(binding: BlockInputBinding): void {
    this.bindings.set(binding.id, binding);
    const keys = binding.keys || [];
    for (const k of keys) {
      const arr = this.keyToBindings.get(k) || [];
      arr.push(binding);
      this.keyToBindings.set(k, arr);
    }
  }

  getById(id: string): BlockInputBinding | undefined {
    return this.bindings.get(id);
  }

  getByKey(key: string): BlockInputBinding[] {
    return this.keyToBindings.get(key) || [];
  }

  getAll(): BlockInputBinding[] {
    return Array.from(this.bindings.values());
  }
}

export const InputRegistry = new InputRegistryImpl();

