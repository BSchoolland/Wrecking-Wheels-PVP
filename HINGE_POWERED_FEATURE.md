# Powered Hinge Feature Implementation

## Overview
Added a powered rotation feature to the Hinge block with Q/E key bindings. This complements the existing passive A/D rotation controls.

## Key Features
- **Q Key**: Rotate left (counterclockwise)
- **E Key**: Rotate right (clockwise)
- **Range**: ±90 degrees
- **Rotation Geometry**: Circular path with formula-based positioning
- **Speed**: Faster than passive rotation (0.05 vs 0.03 radians/frame)

## Geometry Details
The hinge uses a circular rotation path where:
- Circle is centered at (0, -distance/2) with radius distance/2
- Starting position (0°): pointB = (0, 0)
- At 90°: pointB = (distance/2, -distance/2)
- At -90°: pointB = (-distance/2, -distance/2)

**Formula**:
```
x = (distance/2) * sin(angle)
y = -(distance/2) * (1 - cos(angle))
```

This creates the geometry you described: "a circle above the origin that just touches it."

## Input System Architecture

### 1. **Input Registration** (InputRegistry)
- Located in: `frontend/src/game/input/InputSystem.ts`
- Blocks register key bindings at module load time
- Each binding has:
  - **id**: Unique identifier (e.g., 'hinge-powered')
  - **keys**: Array of keyboard keys that trigger it
  - **makePayload**: Converts KeyboardEvent to payload object
  - **apply**: Executes when input activates (press/release)
  - **onLocalVisual**: Optional local-only visual effects

### 2. **Input Flow**
```
User presses key
    ↓
InputController.onKeyDown()
    ↓
InputRegistry.getByKey(key)
    ↓
BlockInputBinding.apply()
    ↓
PhysicsEngine.setHingePoweredInput()
    ↓
Store in hingePoweredInput Map
    ↓
beforeUpdate loop processes all bodies
    ↓
PhysicsEngine calls block.setPoweredInput()
    ↓
HingeBlock.rotate() updates constraint.pointB
```

### 3. **Input Bindings**

**Passive Rotation (A/D)**:
```typescript
InputRegistry.register({
  id: 'hinge-axis',
  keys: ['a', 'A', 'd', 'D'],
  apply: (ctx, phase, payload) => {
    physics.setWheelInput(ctx.playerId, payload.value);
  }
});
```

**Powered Rotation (Q/E)**:
```typescript
InputRegistry.register({
  id: 'hinge-powered',
  keys: ['q', 'Q', 'e', 'E'],
  apply: (ctx, phase, payload) => {
    physics.setHingePoweredInput(ctx.playerId, payload.value);
  }
});
```

### 4. **Physics Engine Processing**

In `PhysicsEngine.beforeUpdate()`:
1. Iterates through all bodies in the world
2. For bodies labeled with '-attach' (hinge attachment faces):
   - Retrieves the block reference from the body
   - Checks if block has `setPoweredInput` method (type guard for hinge blocks)
   - Calls `block.setPoweredInput(input)` with the stored input value

```typescript
if (ownerId && body.label?.endsWith('-attach')) {
  const block = (body as unknown as { block?: { setPoweredInput?: (value: number) => void } }).block;
  if (block && typeof block.setPoweredInput === 'function') {
    const input = this.hingePoweredInput.get(ownerId) || 0;
    block.setPoweredInput(input);
  }
}
```

## Files Modified

### 1. `frontend/src/game/contraptions/blocks/Hinge.ts`
- Added `setPoweredInput(direction: number)` method
- Added `poweredRotationSpeed` constant (0.05)
- Updated `rotate()` method to accept `powered` parameter
- Changed rotation geometry from full circle to circular path
- Updated `reset()` to position pointB at (0, 0)
- Added Q/E input registration in module IIFE

### 2. `frontend/src/core/physics/PhysicsEngine.ts`
- Added `hingePoweredInput: Map<string, number>` private field
- Added `setHingePoweredInput(playerId: string, value: number)` public method
- Added powered input application in `beforeUpdate()` loop

## Input Payload Format

The input system uses a simple payload format:

```typescript
{
  value: 1  // 1 for right/forward, -1 for left/backward, 0 for release
}
```

## Key Design Decisions

1. **Circular Geometry**: Used a circular path rather than full pendulum rotation because:
   - Creates more intuitive hinge behavior
   - Prevents excessive angles (capped at 90°)
   - Matches the "circle touches origin" description

2. **Faster Powered Rotation**: Powered input uses 0.05 rad/frame vs 0.03 for passive:
   - Provides feedback that powered rotation is different
   - Allows players to control speed with A/D vs automatic with Q/E

3. **Type Safety**: Used type guards and duck typing for block methods:
   - Checks `body.label?.endsWith('-attach')` to identify hinge bodies
   - Uses `typeof block.setPoweredInput === 'function'` to safely call method
   - Prevents runtime errors on non-hinge blocks

## Testing

To test the feature:
1. Build a contraption with hinge blocks
2. Press Q to rotate left, E to rotate right
3. Press A to rotate slowly left, D to rotate slowly right
4. Notice faster, more responsive rotation with Q/E
5. Observe geometric path: smooth curve from (0,0) to (distance/2, -distance/2)

## Future Enhancements

- Energy consumption tracking for powered rotation
- Visual feedback (glow/highlight) when powered rotation active
- Configurable powered rotation speed per hinge
- Momentum/inertia for more realistic physics
