/**
 * Server-side input bindings for block controls.
 * These mirror the shared block registrations but ensure the backend
 * `InputRegistry` always has the bindings used by `GameSession`.
 */

import { InputRegistry } from '@shared/input/InputSystem';
import { WheelBlock } from '@shared/contraptions/blocks/WheelBlock';
import { HingeBlock } from '@shared/contraptions/blocks/Hinge';
import { RocketBlock } from '@shared/contraptions/blocks/RocketBlock';

// Register bindings at module load
(() => {
  // Wheel axis (A/D)
  InputRegistry.register({
    id: 'wheel-axis',
    pressDelayMs: WheelBlock.INPUT_DELAY_MS,
    apply: (ctx, phase, payload) => {
      const physics = ctx.physics;
      if (!physics) return;
      const value =
        phase === 'release'
          ? 0
          : typeof payload?.value === 'number'
            ? (payload.value as number)
            : 0;
      physics.setWheelInput(ctx.playerId, value);
    },
  });

  // Hinge axis (Q/E)
  InputRegistry.register({
    id: 'hinge-axis',
    pressDelayMs: HingeBlock.INPUT_DELAY_MS,
    apply: (ctx, phase, payload) => {
      const physics = ctx.physics;
      if (!physics) return;
      const value =
        phase === 'release'
          ? 0
          : typeof payload?.value === 'number'
            ? (payload.value as number)
            : 0;
      physics.setHingeInput(ctx.playerId, value);
    },
  });

  // Rocket hold (Shift)
  InputRegistry.register({
    id: 'rocket-hold',
    pressDelayMs: RocketBlock.INPUT_DELAY_MS,
    apply: (ctx, phase) => {
      const physics = ctx.physics;
      if (!physics) return;
      if (phase === 'press') {
        physics.setRocketHold(ctx.playerId, true);
      } else if (phase === 'release') {
        physics.setRocketHold(ctx.playerId, false);
      }
    },
  });
})();


