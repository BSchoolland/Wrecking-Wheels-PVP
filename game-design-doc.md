# Contraption Battle Game - Design Document

## Core Concept
A 2D physics-based multiplayer battle game where players build custom contraptions and deploy them strategically to defeat opponents. Think "Bad Piggies meets Clash Royale" with deep construction mechanics and emergent combat.

## Key Design Pillars

### 1. Building Over Reflexes
- Depth comes from **contraption design**, not twitch skills
- Players express creativity and engineering problem-solving
- Victory through clever builds and strategic deployment

### 2. Physics-Driven Combat
- Heavy, weighty interactions between vehicles
- Gravity-based mechanics (side-view perspective)
- Emergent outcomes from contraption collisions

### 3. Friends-First Multiplayer
- Designed for small player base (you + friends)
- Real-time strategic deployment
- Peer-to-peer with thin server for matchmaking

## Core Gameplay Loop

### Build Phase
1. Players construct contraptions from available parts
2. Create a "deck" of multiple vehicle designs
3. Each contraption has a deployment cost

### Battle Phase
1. Players take turns deploying contraptions on a 2D battlefield
2. Units take ~1 second to construct/place (masks network latency)
3. Contraptions move autonomously once deployed
4. Battle continues until win condition met

### Win Conditions (TBD)
- Destroy opponent's base
- Push enemy line back to their side
- Survive for X minutes
- Score-based (damage dealt, units destroyed)

## Technical Architecture

### Networking Model: Peer-to-Peer Host/Client
**Why:** Simple, cheap, works great for friends playing together

**How it works:**
- One player acts as **host** (runs authoritative physics simulation)
- Other player is **client** (receives state updates, renders smoothly)
- Thin server handles matchmaking, stats, lobby (not physics)

**State Synchronization:**
- Host sends state snapshots 10-20 times per second
- Client interpolates between snapshots for smooth rendering
- Client runs no game logic, only rendering

**Input Handling:**
- Both players send deployment commands to host
- 1-second construction animation masks network latency
- Client shows optimistic feedback (immediate animation start)

### Physics Engine: Matter.js
- Familiar from previous project
- Good enough performance for initial scope
- Runs only on host machine
- Can be swapped later if performance becomes issue

**Best Practices:**
- Fixed timestep (60fps) for consistency
- Composite bodies for complex contraptions
- Efficient state serialization for networking

### Technology Stack
- **Platform:** Web (no game engine)
- **Physics:** Matter.js
- **Rendering:** Canvas or WebGL (TBD)
- **Networking:** WebRTC or similar for peer-to-peer
- **Backend:** Thin server (Firebase/Supabase or custom) for:
  - Matchmaking
  - Player profiles
  - Contraption storage
  - Stats/leaderboards
  - Friends system

## Battlefield Design

### 2D Side-View with Vertical Depth
- Single primary horizontal lane (not multi-lane like Clash Royale)
- Vertical space matters: flying, climbing, ground movement
- Strategic depth comes from terrain interaction, not lane choice

### Dynamic Terrain
Key differentiator from other games:

**Examples:**
- Hill with tunnel underneath (can be opened/collapsed)
- Gaps that only small contraptions fit through
- Destructible obstacles
- Terrain that collapses under heavy weight

**Strategic Implications:**
- Drill vehicle opens tunnel → flanking opportunities
- Heavy tank forced to go over, light scout slips through gap
- Terraform to force enemies into disadvantageous positions

### Contraption Behaviors
**Initial Design:** Mostly autonomous
- Move forward by default
- Simple behaviors based on design (not player-programmed)
- Heavy builds push, light builds path around obstacles
- Fliers naturally take different altitudes

**Future Expansion (Post-MVP):**
- Sensor-based conditional logic
- "When proximity sensor triggers → fire weapon"
- Visual programming (wire sensors to actions)
- Keep it simple and understandable

## Game Modes

### Primary: Strategic Deployment (MVP)
- Both players deploy contraptions in real-time
- Resource/cost system limits spam
- Tactical decisions: when and where to deploy

### Secondary: Asynchronous Defense Raids
- Build and save defensive lineup
- Friends attack your defense when you're offline
- Results saved and shared
- Good for extending replayability without always-online requirement

### Tertiary: Local Hot-Seat (Easy Win)
- Two players on same machine
- Take turns placing, then watch battle
- Zero networking complexity
- Great for testing and friend gatherings

## Development Priorities

### Phase 1: Core Mechanics (MVP)
- [ ] Basic contraption building interface
- [ ] Matter.js physics integration
- [ ] Simple terrain with obstacles
- [ ] Host/client networking for 1v1
- [ ] Deployment system with costs
- [ ] Basic win condition

### Phase 2: Polish & Content
- [ ] Multiple contraption parts and variety
- [ ] Dynamic terrain mechanics
- [ ] Construction animations
- [ ] Visual/audio polish
- [ ] Tutorial/campaign to teach mechanics

### Phase 3: Meta Systems
- [ ] Thin server for matchmaking
- [ ] Player profiles and progression
- [ ] Contraption saving/sharing
- [ ] Stats and leaderboards
- [ ] Asynchronous raid mode

### Phase 4: Advanced Features (Post-Launch)
- [ ] Sensor/conditional programming system
- [ ] More complex terrain interactions
- [ ] Tournament/ranked mode
- [ ] Spectator features
- [ ] Mobile version?

## Open Questions / To Be Decided

1. **Resource System:** How do players earn deployment points during battle?
   - Passive income over time?
   - Earn from destroying enemies?
   - Fixed amount at start?

2. **Contraption Limits:** 
   - Max parts per contraption?
   - Max contraptions in a deck?
   - Balance small/cheap vs large/expensive?

3. **Match Duration:** 
   - 3 minutes? 5 minutes?
   - Sudden death overtime?

4. **Camera System:**
   - Follow the action automatically?
   - Player-controlled pan/zoom?
   - Split view for large battlefields?

5. **Balance Philosophy:**
   - Rock-paper-scissors between contraption types?
   - Or pure emergent balance from physics?

## Success Criteria

**Minimum Success:**
- You and 3-4 friends regularly play and enjoy it
- Can host matches reliably
- Building contraptions is fun and expressive
- Battles are exciting to watch

**Stretch Success:**
- Small community forms (50+ active players)
- Player-created contraptions are creative and varied
- Organic content creation (people sharing cool builds)
- Could expand to larger player base if desired

## Why This Will Work

1. **Clear differentiator:** Physics-based building + strategic deployment is unique
2. **Realistic scope:** Starting small, designed for friends first
3. **Technical feasibility:** Peer-to-peer reduces complexity and cost
4. **Passion-driven:** Building something new and interesting, not retreading old ground
5. **Iterative design:** Can start simple and add depth over time