# Network Bandwidth Analysis - Wrecking Wheels PVP

## Typical Snapshot Sizes

### Per-Body JSON Structure
Each physics body in a snapshot looks like this:
```json
{
  "id": "body-12345",
  "position": {"x": 100.5, "y": 200.3},
  "angle": 1.234,
  "vertices": [{"x": 110, "y": 190}, {"x": 90, "y": 190}, ...],  // Only on new bodies
  "circleRadius": 25,
  "isStatic": false,
  "render": {"fillStyle": "#3498db", "healthPercent": 0.8},
  "ownerId": "player-host",                                        // Only on new bodies
  "label": "wheel-1",                                              // Only on new bodies
  "sprite": {"sheet": "blocks.png", "row": 0, ...},              // Only on new bodies
  "velocity": {"x": 1.5, "y": -0.3},
  "angularVelocity": 0.05
}
```

### Size Estimates
- **Simple body (no vertices)**: ~180 bytes
- **Body with 4 vertices**: ~350 bytes
- **Body with 20 vertices**: ~1,200 bytes (typical block)

### Full Snapshot Examples
| Scenario | Bodies | Avg Size/Body | Total Size | Frequency | Bandwidth |
|----------|--------|--------------|-----------|-----------|-----------|
| Early game (10 bodies, small) | 10 | 400B | 4 KB | 20Hz | 80 KB/s |
| Mid game (20 bodies mixed) | 20 | 800B | 16 KB | 20Hz | 320 KB/s |
| Full match (30+ bodies, complex) | 30 | 1.2 KB | 36 KB | 20Hz | 720 KB/s |

**At 20Hz with 30 bodies: ~720 KB/s!**

---

## Why The Queue Fills With High Latency

### RTT Window Calculation

| One-Way Latency | RTT | Packets in Flight | Snapshot Size | Total Buffered |
|-----------------|-----|-------------------|---------------|----------------|
| 50ms (good) | 100ms | 2 snapshots | 16 KB | 32 KB ✓ |
| 100ms (fair) | 200ms | 4 snapshots | 16 KB | 64 KB ✓ (edge) |
| 265ms (poor) | 530ms | 10 snapshots | 16 KB | 160 KB ❌ |
| 265ms | 530ms | 10 snapshots | 36 KB | 360 KB ❌❌ |

**Your current situation with 530ms RTT:**
- At 50ms send interval: **10-11 packets queued simultaneously**
- If each is 20KB: **200-220 KB buffered**
- Our 65 KB limit: **queue fills immediately**

---

## Solutions (Ranked by Urgency)

### ✅ **ALREADY IMPLEMENTED**
1. **Adaptive rate based on latency** (3 tiers)
   - <75ms one-way: 20Hz (50ms)
   - 75-200ms: 10Hz (100ms)
   - >200ms: 5Hz (200ms)

2. **Backpressure check** before sending
   - Skip frame if queue > 65KB
   - Prevents crashes, allows graceful degradation

3. **Verbose logging** to see:
   - Snapshot sizes
   - Buffer queue status
   - Effective send rate

### 🟡 **MEDIUM PRIORITY** (Do Next)

**Reduce Payload Size** - Only send changed data
```typescript
// Currently: Send every body's position/angle every frame
// Better: Send only bodies that moved significantly since last update

// Pseudocode:
if (body.positionChanged || body.angleChanged) {
  include in snapshot
} else {
  skip (already know its state)
}
```
**Savings**: ~40-60% reduction

**Stop Sending Velocity/Angular Velocity**
- Used for interpolation, but we have better methods
- Each field adds ~50 bytes per body
**Savings**: ~5-10 KB per snapshot

### 🔴 **LOWER PRIORITY** (Reserve for later)

**Delta Compression** - Only send full body on spawn
- Subsequent frames: position + angle only
- Reconstruct vertices on client from cache
**Savings**: ~70-80% for steady-state

**Compress JSON**
- Use binary serialization instead of JSON
- Use MessagePack, Protocol Buffers, or gzip
**Savings**: ~40-60% compression ratio

---

## What You Should See Now (After Our Changes)

### Console Logs

**Low Latency (no simulated latency):**
```
🌐 One-way: 15ms → Sending at 20Hz (50ms)
📤 Snapshot: 20 bodies, 15.2KB
✓ Buffer: 2.1KB / 64KB
```

**Moderate Latency (100-150ms simulated):**
```
🌐 One-way: 120ms → Sending at 10Hz (100ms)
📤 Snapshot: 20 bodies, 15.2KB
✓ Buffer: 35.8KB / 64KB
```

**High Latency (>250ms simulated):**
```
🌐 One-way: 265ms → Sending at 5Hz (200ms)
📤 Snapshot: 20 bodies, 15.2KB
✓ Buffer: 48.2KB / 64KB
```

**If Queue Still Fills:**
```
❌ Physics channel send queue full, skipping state update
❌ Buffer: 75.3KB / 64KB
```

---

## What's Going Wrong on Your End

With 530ms RTT showing repeatedly, one of these is true:

1. **One-way estimate not working** - `getEstimatedOneWayMs()` may return 0
   → Check NetworkManager RTT calculation

2. **Snapshot still too large** - Look at console debug output
   → If >30KB, need delta compression

3. **Network is actually unstable** - RTT oscillating wildly
   → May need lower thresholds or different approach

4. **Buffer threshold too high** - 65KB might not be enough for your hardware
   → Could try 32KB or 48KB

---

## Quick Test

1. **Open DevTools Console** in dev mode
2. **Look for these patterns:**
   - `📤 Snapshot: X bodies, XXX.XKB` - tells you payload size
   - `🌐 One-way: XXms → Sending at XHz` - tells you what rate was chosen
   - `Buffer: XXkb / 64KB` - tells you queue pressure

3. **Then simulate latency** in DevTools:
   - Network tab → Settings → Add custom profile
   - Add 100ms, 200ms, 300ms latencies
   - Watch how the send rate adapts

---

## Recommendation

**Run with these changes for 24 hours:**
1. The logging will tell you if the adaptive rate is working
2. If `One-way` is showing <200ms, but queue still fills → payload is too big
3. If `One-way` is showing >200ms but rate is still 20Hz → estimate broken

Report back with the console logs and we'll know exactly which direction to fix! 🎯
