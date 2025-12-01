/**
 * Input System - Frontend-specific InputController
 * Registry and types are re-exported from shared
 */

import type { PhysicsEngine } from '@shared/physics/PhysicsEngine';
import { InputRegistry } from '@shared/input/InputSystem';
import type { InputPhase, BlockInputPayload} from '@shared/input/InputSystem';

// Re-export everything from shared for convenience
export * from '@shared/input/InputSystem';

export interface InputControllerConfig {
  role: 'host' | 'client';
  playerId: string;
  sendCommand?: (bindingId: string, phase: InputPhase, payload?: BlockInputPayload) => void;
  physics?: PhysicsEngine | null;
  effects?: { startWheelGlow?: (playerId: string) => void; stopWheelGlow?: (playerId: string) => void } | null;
}

export class InputController {
  private config: InputControllerConfig;
  private keyDownSet: Set<string> = new Set();
  private localState: Record<string, unknown> = {};
  private pendingTimers: Map<string, number> = new Map();

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
      if (this.config.effects && b.onLocalVisual) {
        b.onLocalVisual(this.config.effects, this.config.playerId, 'press', payload);
      }
      if (this.config.sendCommand) {
        console.log(`[InputController] Sending input: bindingId=${b.id}, phase=press, playerId=${this.config.playerId}`);
        this.config.sendCommand(b.id, 'press', payload);
      } else if (this.config.physics) {
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
      if (this.config.effects && b.onLocalVisual) {
        b.onLocalVisual(this.config.effects, this.config.playerId, 'release', payload);
      }
      if (this.config.sendCommand) {
        console.log(`[InputController] Sending input: bindingId=${b.id}, phase=release, playerId=${this.config.playerId}`);
        this.config.sendCommand(b.id, 'release', payload);
      } else if (this.config.physics) {
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
