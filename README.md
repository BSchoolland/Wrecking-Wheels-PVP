# Wrecking Wheels PVP

A 2D physics-based multiplayer battle game where players build custom contraptions and deploy them strategically to defeat opponents.

## Architecture Overview

### Frontend (`/frontend`)
- **TypeScript + Vite + React**
- **Matter.js** for physics (host-only)
- **Canvas 2D** for rendering
- **WebRTC** for peer-to-peer networking

**Key Systems:**
- `/core/physics` - Matter.js wrapper and physics simulation
- `/core/state` - Game state management
- `/core/networking` - WebRTC peer-to-peer connection
- `/game` - Game logic (contraptions, battle, terrain)
- `/rendering` - Canvas renderer
- `/ui` - React components for menus and UI

### Backend (`/backend`)
- **TypeScript + Express**
- **SQLite** database (Drizzle ORM)
- **WebSocket** for matchmaking/lobby

**Purpose:**
- Matchmaking and lobby system
- Player profiles and authentication
- Contraption storage
- Stats and leaderboards
- WebRTC signaling server

### Shared (`/shared`)
- TypeScript types and interfaces
- Game constants
- Shared validation logic

## Getting Started

### Prerequisites
- Node.js 18+
- npm or pnpm

### Installation & Running

**Option 1: Use the launch script (recommended)**
```bash
chmod +x launch.sh
./launch.sh
```

**Option 2: Manual launch**

Terminal 1 (Backend):
```bash
cd backend
npm install
npm run dev
```

Terminal 2 (Frontend):
```bash
cd frontend
npm install
npm run dev
```

The frontend will be available at `http://localhost:3000`
The backend API will be available at `http://localhost:3001`

## Architecture Principles

### Host-Authoritative Model
- **Host** runs all game logic and physics simulation
- **Client** only renders received state (no game logic)
- State synchronized 20 times per second
- Commands sent from client → host with ~1s construction animation to mask latency

### State-Driven Design
- Single source of truth: `GameState` object
- All rendering is pure: `render(state) → pixels`
- Physics state serialized for network transmission
- Fixed timestep (60fps) for deterministic simulation

### Modular Systems
- Physics engine abstracted (easy to swap Matter.js later)
- Renderer separated from game logic
- Networking layer isolated from game systems
- Game logic in `/game`, engine stuff in `/core`

## Development Roadmap

### Phase 1: Core Mechanics (MVP)
- [ ] Basic contraption building interface
- [ ] Matter.js physics integration ✅ (scaffold created)
- [ ] Simple terrain with obstacles
- [ ] Host/client networking for 1v1 ✅ (scaffold created)
- [ ] Deployment system with costs ✅ (scaffold created)
- [ ] Basic win condition

### Phase 2: Polish & Content
- [ ] Multiple contraption parts and variety
- [ ] Dynamic terrain mechanics
- [ ] Construction animations
- [ ] Visual/audio polish
- [ ] Tutorial/campaign

### Phase 3: Meta Systems
- [ ] Thin server for matchmaking ✅ (scaffold created)
- [ ] Player profiles and progression
- [ ] Contraption saving/sharing
- [ ] Stats and leaderboards
- [ ] Asynchronous raid mode

## Tech Stack

**Frontend:**
- TypeScript
- Vite (build tool)
- React (UI framework)
- Matter.js (physics engine)
- Canvas 2D (rendering)
- WebRTC (peer-to-peer networking)

**Backend:**
- TypeScript
- Express (API server)
- SQLite + Drizzle ORM (database)
- WebSocket (lobby/signaling)

## Project Structure

```
/frontend/
  /src/
    /core/              # Core engine systems
      /state/           # Game state management
      /physics/         # Physics engine wrapper
      /networking/      # WebRTC connection
    /game/              # Game-specific logic
      /contraptions/    # Contraption building
      /battle/          # Battle logic
      /terrain/         # Terrain system
    /rendering/         # Canvas renderer
    /ui/                # React UI components
    /types/             # TypeScript types

/backend/
  /src/
    /api/               # REST API endpoints
    /matchmaking/       # Lobby system
    /database/          # Database schema
    /auth/              # Authentication
    /storage/           # Contraption storage

/shared/                # Shared code
  /types/               # Shared TypeScript types
  /constants/           # Game constants
  /validation/          # Shared validation

game-design-doc.md      # Full design document
launch.sh               # Quick launch script
```

## Contributing

This is a personal project, but feel free to explore and learn from the architecture!

## License

TBD
