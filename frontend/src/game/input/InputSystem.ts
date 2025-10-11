import type { NetworkRole } from '@/core/networking/NetworkManager';
import type { PhysicsEngine } from '@/core/physics/PhysicsEngine';

export type InputPhase = 'press' | 'release' | 'change';

export interface BlockInputPayload {
  // Arbitrary payload, commonly { value: number } for axes
  [key: string]: unknown;
}

export interface BlockInputContext {
  role: NetworkRole;
  playerId: string;
  physics?: PhysicsEngine | null; // host or local-only
}

export interface BlockInputBinding {
  id: string; // globally unique id, e.g. 'rocket-hold', 'wheel-axis'
  // Keyboard keys for this binding (KeyboardEvent.key or code). Empty if programmatic only
  keys?: string[];
  // Delay to apply before a press becomes active (ms). Releases are immediate unless specified via releaseDelayMs
  pressDelayMs?: number;
  releaseDelayMs?: number;
  // Optional helper to compute payload when a key event occurs
  makePayload?: (e: KeyboardEvent, phase: InputPhase, localState: Record<string, unknown>) => BlockInputPayload | undefined;
  // Apply effect on the host or in local test mode
  apply: (ctx: BlockInputContext, phase: InputPhase, payload?: BlockInputPayload) => void;
  // Optional: local-only visuals (client-side or local test); never networked
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

export interface InputControllerConfig {
  role: NetworkRole;
  playerId: string;
  // Optional hooks for networked mode
  sendCommand?: (bindingId: string, phase: InputPhase, payload?: BlockInputPayload) => void;
  // Optional physics for local/test or host-local input
  physics?: PhysicsEngine | null;
  // Optional renderer effects for local-only visuals
  effects?: { startWheelGlow?: (playerId: string) => void; stopWheelGlow?: (playerId: string) => void } | null;
}

export class InputController {
  private config: InputControllerConfig;
  private keyDownSet: Set<string> = new Set();
  private localState: Record<string, unknown> = {};
  private pendingTimers: Map<string, number> = new Map(); // key: bindingId

  constructor(config: InputControllerConfig) {
    this.config = config;
  }

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown, { passive: true });
    window.addEventListener('keyup', this.onKeyUp, { passive: true });
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown as EventListener);
    window.removeEventListener('keyup', this.onKeyUp as EventListener);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    const bindings = [...InputRegistry.getByKey(e.key), ...InputRegistry.getByKey((e as unknown as { code?: string }).code || '')];
    if (bindings.length === 0) return;
    this.keyDownSet.add(e.key);

    for (const b of bindings) {
      const payload = b.makePayload ? b.makePayload(e, 'press', this.localState) : undefined;
      // Always trigger local visuals immediately if available
      if (this.config.effects && b.onLocalVisual) {
        b.onLocalVisual(this.config.effects, this.config.playerId, 'press', payload);
      }
      if (this.config.sendCommand) {
        this.config.sendCommand(b.id, 'press', payload);
      } else if (this.config.physics) {
        // Local/host-direct: honor pressDelayMs
        const delay = b.pressDelayMs || 0;
        if (delay > 0) {
          const timer = window.setTimeout(() => {
            this.pendingTimers.delete(b.id);
            b.apply({ role: this.config.role, playerId: this.config.playerId, physics: this.config.physics }, 'press', payload);
          }, delay);
          this.pendingTimers.set(b.id, timer);
        } else {
          b.apply({ role: this.config.role, playerId: this.config.playerId, physics: this.config.physics }, 'press', payload);
        }
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const bindings = [...InputRegistry.getByKey(e.key), ...InputRegistry.getByKey((e as unknown as { code?: string }).code || '')];
    if (bindings.length === 0) return;
    this.keyDownSet.delete(e.key);

    for (const b of bindings) {
      const payload = b.makePayload ? b.makePayload(e, 'release', this.localState) : undefined;
      // Local visuals on release
      if (this.config.effects && b.onLocalVisual) {
        b.onLocalVisual(this.config.effects, this.config.playerId, 'release', payload);
      }
      if (this.config.sendCommand) {
        this.config.sendCommand(b.id, 'release', payload);
      } else if (this.config.physics) {
        // Cancel any pending press timer if release occurs before activation
        const t = this.pendingTimers.get(b.id);
        if (t !== undefined) {
          window.clearTimeout(t);
          this.pendingTimers.delete(b.id);
        }
        b.apply({ role: this.config.role, playerId: this.config.playerId, physics: this.config.physics }, 'release', payload);
      }
    }
  };
}


